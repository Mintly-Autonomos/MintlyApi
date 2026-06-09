import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { setEmailService } from '../../infrastructure/email/email-service'

// Fluxo real de recuperação de senha + lockout contra mongo-memory (replica set).

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

  it('solicita → reseta → loga com a nova senha (e a antiga deixa de funcionar)', async () => {
    const env = freshEnv()
    await signup(env)

    const req = await server.inject({ method: 'POST', url: '/auth/recuperar-senha', headers: { env }, payload: { email: SIGNUP.email } })
    expect(req.statusCode).toBe(202)
    expect(sentTokens).toHaveLength(1)

    const reset = await server.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      headers: { env },
      payload: { token: sentTokens[0], newPassword: 'NovaSenha1', confirmNewPassword: 'NovaSenha1' },
    })
    expect(reset.statusCode).toBe(200)

    expect((await login(env, 'Senha123')).statusCode).toBe(401)
    expect((await login(env, 'NovaSenha1')).statusCode).toBe(200)
  })

  it('recuperar-senha para e-mail inexistente responde 202 sem enviar (não revela)', async () => {
    const env = freshEnv()
    await signup(env)
    const res = await server.inject({ method: 'POST', url: '/auth/recuperar-senha', headers: { env }, payload: { email: 'naoexiste@x.com' } })
    expect(res.statusCode).toBe(202)
    expect(sentTokens).toHaveLength(0)
  })

  it('redefinir-senha com token inválido devolve 401', async () => {
    const env = freshEnv()
    await signup(env)
    const res = await server.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      headers: { env },
      payload: { token: 'token-invalido', newPassword: 'NovaSenha1', confirmNewPassword: 'NovaSenha1' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('redefinir-senha com senhas divergentes devolve 400', async () => {
    const env = freshEnv()
    await signup(env)
    const req = await server.inject({ method: 'POST', url: '/auth/recuperar-senha', headers: { env }, payload: { email: SIGNUP.email } })
    expect(req.statusCode).toBe(202)
    const res = await server.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
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

  it('login bem-sucedido grava auditoria de login', async () => {
    const env = freshEnv()
    await signup(env)
    await login(env, 'Senha123')
    const audits = await mongoConnection.getDatabase(env).collection('audit_logs').find({ event: 'login' }).toArray()
    expect(audits.length).toBeGreaterThanOrEqual(1)
  })
})
