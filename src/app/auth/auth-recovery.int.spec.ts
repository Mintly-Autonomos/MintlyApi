import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { setEmailService } from '../../infrastructure/email/email-service'

// Fluxo real de recuperação de senha + lockout + logout contra mongo-memory (replica set).

const SIGNUP = {
  person: { name: 'Dono', phone: '11900000000' },
  email: 'dono@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `inttest_recovery_${++envCounter}`

describe('Auth — recuperação de senha + lockout (integração)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>
  let sentTokens: string[] = []

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
    // captura o token em vez de enviar e-mail real
    setEmailService({ sendPasswordRecovery: async (_to: string, token: string) => { sentTokens.push(token) } })
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  beforeEach(() => { sentTokens = [] })

  const signup = (env: string) => server.inject({ method: 'POST', url: '/auth/signup', headers: { env }, payload: SIGNUP })
  const login = (env: string, password: string) =>
    server.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email: SIGNUP.email, password } })
  const forgot = (env: string, email = SIGNUP.email) =>
    server.inject({ method: 'POST', url: '/auth/forgot-password', headers: { env }, payload: { email } })
  const reset = (env: string, token: string, newPassword = 'NovaSenha1') =>
    server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      headers: { env },
      payload: { token, newPassword, confirmNewPassword: newPassword },
    })

  it('solicita → reseta → loga com a nova senha (e a antiga deixa de funcionar)', async () => {
    const env = freshEnv()
    await signup(env)

    const req = await forgot(env)
    expect(req.statusCode).toBe(202)
    expect(sentTokens).toHaveLength(1)

    expect((await reset(env, sentTokens[0])).statusCode).toBe(200)

    expect((await login(env, 'Senha123')).statusCode).toBe(401)
    expect((await login(env, 'NovaSenha1')).statusCode).toBe(200)
  })

  it('token de reset é de uso único: segunda chamada com o mesmo token devolve 401', async () => {
    const env = freshEnv()
    await signup(env)
    await forgot(env)

    expect((await reset(env, sentTokens[0])).statusCode).toBe(200)
    expect((await reset(env, sentTokens[0], 'OutraSenha1')).statusCode).toBe(401)
  })

  it('armazena no banco o sha256 do token (não o token em claro) e expiresAt como Date', async () => {
    const env = freshEnv()
    await signup(env)
    await forgot(env)

    const doc = await mongoConnection.getDatabase(env).collection('password_reset_tokens').findOne({})
    expect(doc?.token).not.toBe(sentTokens[0])
    expect(doc?.token).toBe(createHash('sha256').update(sentTokens[0]).digest('hex'))
    expect(doc?.expiresAt).toBeInstanceOf(Date)
  })

  it('cria índice TTL em password_reset_tokens', async () => {
    const env = freshEnv()
    await signup(env)
    await forgot(env)

    const indexes = await mongoConnection.getDatabase(env).collection('password_reset_tokens').indexes()
    expect(indexes.some(ix => ix.expireAfterSeconds !== undefined)).toBe(true)
  })

  it('forgot-password para e-mail inexistente responde 202 sem enviar (não revela)', async () => {
    const env = freshEnv()
    await signup(env)
    const res = await forgot(env, 'naoexiste@x.com')
    expect(res.statusCode).toBe(202)
    expect(sentTokens).toHaveLength(0)
  })

  it('reset-password com token inválido devolve 401', async () => {
    const env = freshEnv()
    await signup(env)
    expect((await reset(env, 'token-invalido')).statusCode).toBe(401)
  })

  it('reset-password com senhas divergentes devolve 400', async () => {
    const env = freshEnv()
    await signup(env)
    await forgot(env)
    const res = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      headers: { env },
      payload: { token: sentTokens[0], newPassword: 'NovaSenha1', confirmNewPassword: 'Diferente1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('bloqueia temporariamente após 5 tentativas e devolve 429', async () => {
    const env = freshEnv()
    await signup(env)
    for (let i = 0; i < 5; i++) {
      expect((await login(env, 'ErradaXX1')).statusCode).toBe(401)
    }
    const blocked = await login(env, 'ErradaXX1')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().code).toBe('AUTH-0004')
  })

  it('senha errada em conta inativa devolve 401 genérico; senha correta devolve 403', async () => {
    const env = freshEnv()
    await signup(env)
    await mongoConnection.getDatabase(env).collection('users')
      .updateOne({ email: SIGNUP.email }, { $set: { status: 'inactive' } })

    expect((await login(env, 'ErradaXX1')).statusCode).toBe(401)
    expect((await login(env, 'Senha123')).statusCode).toBe(403)
  })

  it('login bem-sucedido grava auditoria de login com restaurantId', async () => {
    const env = freshEnv()
    await signup(env)
    await login(env, 'Senha123')
    const audits = await mongoConnection.getDatabase(env).collection('audit_logs').find({ event: 'login' }).toArray()
    expect(audits.length).toBeGreaterThanOrEqual(1)
    expect(audits[0].restaurantId).toBeTruthy()
  })

  it('logout sem Bearer token devolve 401', async () => {
    const env = freshEnv()
    await signup(env)
    const res = await server.inject({ method: 'POST', url: '/auth/logout', headers: { env }, payload: { refreshToken: 'rt' } })
    expect(res.statusCode).toBe(401)
  })

  it('logout autenticado revoga o refresh token e grava auditoria de logout', async () => {
    const env = freshEnv()
    await signup(env)
    const session = (await login(env, 'Senha123')).json().payload

    const res = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { env, authorization: `Bearer ${session.accessToken}` },
      payload: { refreshToken: session.refreshToken },
    })
    expect(res.statusCode).toBe(204)

    const audits = await mongoConnection.getDatabase(env).collection('audit_logs').find({ event: 'logout' }).toArray()
    expect(audits).toHaveLength(1)
    expect(audits[0].restaurantId).toBeTruthy()

    // refresh revogado não pode mais ser usado
    const refresh = await server.inject({ method: 'POST', url: '/auth/refresh', headers: { env }, payload: { refreshToken: session.refreshToken } })
    expect(refresh.statusCode).toBe(401)
  })
})
