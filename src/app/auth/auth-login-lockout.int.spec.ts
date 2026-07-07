import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

// Integração real do lockout de login (M3): valida o update com PIPELINE de
// agregação de registerFailedAttempt (incremento + bloqueio + reset atômicos)
// contra um MongoDB de verdade — a semântica de $cond/$gte/$$NOW não é
// exercitada por unit test (lá o findOneAndUpdate é mockado).

const SIGNUP_BODY = {
  person: { name: 'Ana', phone: '11999990001' },
  email: 'ana@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante da Ana',
  termsAccepted: true,
}

const MAX = 5 // MAX_LOGIN_ATTEMPTS default

describe('POST /auth/login — lockout atômico (integração)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>
  const env = 'inttest_lockout'
  const headers = { env }

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
    await server.inject({ method: 'POST', url: '/auth/signup', headers, payload: SIGNUP_BODY })
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  const wrongLogin = () =>
    server.inject({ method: 'POST', url: '/auth/login', headers, payload: { email: SIGNUP_BODY.email, password: 'Errada1' } })

  it('incrementa a cada senha errada e bloqueia ao cruzar o teto, zerando o contador', async () => {
    const users = mongoConnection.getDatabase(env).collection('users')

    // A tentativa que cruza o teto ainda responde 401 (resposta de senha errada —
    // não vaza que o bloqueio acabou de ser aplicado). Todas as MAX tentativas: 401.
    for (let i = 0; i < MAX - 1; i++) {
      expect((await wrongLogin()).statusCode).toBe(401)
    }

    const before = await users.findOne({ email: SIGNUP_BODY.email })
    expect(before?.loginAttempts).toBe(MAX - 1)
    expect(before?.blockedUntil == null).toBe(true)

    // MAX-ésima tentativa: cruza o teto e bloqueia (mas ainda 401).
    expect((await wrongLogin()).statusCode).toBe(401)

    const after = await users.findOne({ email: SIGNUP_BODY.email })
    // Ao bloquear, o contador é zerado (evita re-bloqueio imediato ao expirar).
    expect(after?.loginAttempts).toBe(0)
    expect(typeof after?.blockedUntil).toBe('string')
    expect(new Date(after!.blockedUntil as string).getTime()).toBeGreaterThan(Date.now())

    // Auditoria do bloqueio foi registrada.
    const blockLog = await mongoConnection
      .getDatabase(env)
      .collection('audit_logs')
      .findOne({ event: 'account_temporarily_blocked' })
    expect(blockLog).not.toBeNull()
  })

  it('estando bloqueada, novas tentativas retornam 429 sem re-incrementar o contador', async () => {
    const users = mongoConnection.getDatabase(env).collection('users')
    const res = await wrongLogin()
    expect(res.statusCode).toBe(429)
    // O gate barra antes de qualquer verificação/incremento — contador segue em 0.
    const doc = await users.findOne({ email: SIGNUP_BODY.email })
    expect(doc?.loginAttempts).toBe(0)
  })
})
