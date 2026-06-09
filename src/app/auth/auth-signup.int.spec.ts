import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

// Integração real: stack route -> controller -> use case -> repo contra um
// MongoDB em memória em modo replica set (necessário para a transação do signup).

const SIGNUP_BODY = {
  person: { name: 'João Silva', phone: '11999990000' },
  email: 'joao@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante do João',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `inttest_${++envCounter}`

describe('POST /auth/signup (integração)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  function signup (env: string, body: Record<string, unknown> = SIGNUP_BODY) {
    return server.inject({ method: 'POST', url: '/auth/signup', headers: { env }, payload: body })
  }

  it('cria person + restaurant + user + 1 conta + 6 categorias + 4 auditorias', async () => {
    const env = freshEnv()
    const res = await signup(env)
    expect(res.statusCode).toBe(201)

    const db = mongoConnection.getDatabase(env)
    expect(await db.collection('people').countDocuments()).toBe(1)
    expect(await db.collection('restaurants').countDocuments()).toBe(1)
    expect(await db.collection('users').countDocuments()).toBe(1)
    expect(await db.collection('financial_accounts').countDocuments()).toBe(1)
    expect(await db.collection('financial_categories').countDocuments()).toBe(6)
    expect(await db.collection('audit_logs').countDocuments()).toBe(4)
  })

  it('retorna tokens, user (sem passwordHash) e restaurant no payload', async () => {
    const { payload } = (await signup(freshEnv())).json()
    expect(payload.accessToken).toBeTruthy()
    expect(payload.refreshToken).toBeTruthy()
    expect(payload.user.email).toBe('joao@restaurante.com')
    expect(payload.user.person.name).toBe('João Silva')
    expect(payload.user.passwordHash).toBeUndefined()
    expect(payload.restaurant.name).toBe('Restaurante do João')
  })

  it('persiste o user com hash (não senha pura), role owner e person como ref', async () => {
    const env = freshEnv()
    await signup(env)
    const user = await mongoConnection.getDatabase(env).collection('users').findOne({ email: SIGNUP_BODY.email })
    expect(user?.passwordHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/)
    expect(user?.passwordHash).not.toContain('Senha123')
    expect(user?.role).toBe('owner')
    expect(user?.status).toBe('active')
    expect(user?.person?.name).toBe('João Silva')
    expect(user?.restaurantId).toBeTruthy()
    expect(user?.audit?.createdAt).toBeTruthy()
  })

  it('semeia categorias isSystem (2 revenue + 4 expense) e conta Caixa cash/default', async () => {
    const env = freshEnv()
    await signup(env)
    const db = mongoConnection.getDatabase(env)
    const cats = await db.collection('financial_categories').find().toArray()
    expect(cats.every(c => c.isSystem === true)).toBe(true)
    expect(cats.filter(c => c.type === 'revenue')).toHaveLength(2)
    expect(cats.filter(c => c.type === 'expense')).toHaveLength(4)
    const account = await db.collection('financial_accounts').findOne({})
    expect(account?.type).toBe('cash')
    expect(account?.isDefault).toBe(true)
    expect(account?.status).toBe('active')
  })

  it('cria índice único em users.email', async () => {
    const env = freshEnv()
    await signup(env)
    const indexes = await mongoConnection.getDatabase(env).collection('users').indexes()
    const emailIdx = indexes.find(i => (i.key as Record<string, number>)?.email === 1)
    expect(emailIdx?.unique).toBe(true)
  })

  it('retorna 409 e não duplica/parcializa quando o e-mail já existe', async () => {
    const env = freshEnv()
    await signup(env)
    const res = await signup(env)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('AUTH-0002')

    const db = mongoConnection.getDatabase(env)
    expect(await db.collection('users').countDocuments()).toBe(1)
    // rollback transacional: a 2ª tentativa não deixou person/restaurant órfãos
    expect(await db.collection('people').countDocuments()).toBe(1)
    expect(await db.collection('restaurants').countDocuments()).toBe(1)
  })

  it('retorna 400 VALIDATION_ERROR para senha fraca, sem persistir nada', async () => {
    const env = freshEnv()
    const res = await signup(env, { ...SIGNUP_BODY, password: 'fraca' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
    expect(await mongoConnection.getDatabase(env).collection('users').countDocuments()).toBe(0)
  })

  it('retorna 400 quando termsAccepted é false', async () => {
    const res = await signup(freshEnv(), { ...SIGNUP_BODY, termsAccepted: false })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })

  describe('login / refresh / logout', () => {
    const login = (env: string, password = SIGNUP_BODY.password) =>
      server.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email: SIGNUP_BODY.email, password } })

    it('login válido retorna tokens e user sem passwordHash', async () => {
      const env = freshEnv()
      await signup(env)
      const res = await login(env)
      expect(res.statusCode).toBe(200)
      const { payload } = res.json()
      expect(payload.accessToken).toBeTruthy()
      expect(payload.user.email).toBe(SIGNUP_BODY.email)
      expect(payload.user.passwordHash).toBeUndefined()
    })

    it('atualiza lastAccessAt no login', async () => {
      const env = freshEnv()
      await signup(env)
      await login(env)
      const user = await mongoConnection.getDatabase(env).collection('users').findOne({ email: SIGNUP_BODY.email })
      expect(user?.lastAccessAt).toBeTruthy()
    })

    it('401 com senha errada', async () => {
      const env = freshEnv()
      await signup(env)
      expect((await login(env, 'Errada123')).statusCode).toBe(401)
    })

    it('401 com usuário inexistente', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { env: freshEnv() },
        payload: { email: 'naoexiste@x.com', password: 'Senha123' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('refresh devolve novos tokens e logout revoga (204)', async () => {
      const env = freshEnv()
      const refreshToken = (await signup(env)).json().payload.refreshToken
      const refreshed = await server.inject({ method: 'POST', url: '/auth/refresh', headers: { env }, payload: { refreshToken } })
      expect(refreshed.statusCode).toBe(200)
      expect(refreshed.json().payload.accessToken).toBeTruthy()

      const loggedOut = await server.inject({ method: 'POST', url: '/auth/logout', headers: { env }, payload: { refreshToken } })
      expect(loggedOut.statusCode).toBe(204)
    })
  })
})
