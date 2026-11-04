import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

let envCounter = 0
const freshEnv = () => `int_user_${++envCounter}`
const PASSWORD = 'Senha123'

describe('/users/me (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  async function signup (env: string, tag = 'a') {
    const email = `dono_${tag}_${env}@teste.com`
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: PASSWORD, restaurantName: `Cantina ${tag}`, termsAccepted: true, email },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, refreshToken, user } = res.json().payload
    return { env, email, auth: { env, authorization: `Bearer ${accessToken}` }, refreshToken: refreshToken as string, user }
  }

  const login = (env: string, email: string, password: string) =>
    app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password } })
  const refresh = (env: string, refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', headers: { env }, payload: { refreshToken } })
  const call = (method: 'GET' | 'PATCH' | 'POST', url: string, auth: Record<string, string>, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: auth, payload })

  describe('GET /users/me', () => {
    it('devolve nome, e-mail, telefone e papel, sem o hash da senha', async () => {
      const { auth, email } = await signup(freshEnv())
      const res = await call('GET', '/users/me', auth)
      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toEqual({ name: 'Dono a', email, phone: '11977777777', role: 'owner' })
      expect(JSON.stringify(res.json())).not.toContain('passwordHash')
    })

    it('exige login', async () => {
      const res = await app.inject({ method: 'GET', url: '/users/me', headers: { env: freshEnv() } })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('PATCH /users/me', () => {
    it('muda nome e telefone nos dois lugares (people e a referência em users)', async () => {
      const env = freshEnv()
      const { auth, email, user } = await signup(env)
      const res = await call('PATCH', '/users/me', auth, { name: '  Davi Lee ', phone: '11988887777' })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toMatchObject({ name: 'Davi Lee', phone: '11988887777', email })

      const db = mongoConnection.getDatabase(env)
      const person = await db.collection('people').findOne({ _id: new ObjectId(user.person._id) })
      const stored = await db.collection('users').findOne({ email })
      expect(person).toMatchObject({ name: 'Davi Lee', phone: '11988887777' })
      expect(stored?.person).toMatchObject({ name: 'Davi Lee' })

      const again = await login(env, email, PASSWORD)
      expect(again.json().payload.user.person.name).toBe('Davi Lee')
    })

    it('muda só o telefone sem tocar no nome', async () => {
      const { auth } = await signup(freshEnv())
      const res = await call('PATCH', '/users/me', auth, { phone: '11955554444' })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toMatchObject({ name: 'Dono a', phone: '11955554444' })
    })

    it('corpo vazio não muda nada', async () => {
      const { auth } = await signup(freshEnv())
      const res = await call('PATCH', '/users/me', auth, {})
      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toMatchObject({ name: 'Dono a' })
    })

    it('rejeita nome/telefone curtos e campos que não são daqui (e-mail, papel, status)', async () => {
      const { auth } = await signup(freshEnv())
      expect((await call('PATCH', '/users/me', auth, { name: 'D' })).statusCode).toBe(400)
      expect((await call('PATCH', '/users/me', auth, { phone: '123' })).statusCode).toBe(400)
      expect((await call('PATCH', '/users/me', auth, { email: 'x@y.com' })).statusCode).toBe(400)
      expect((await call('PATCH', '/users/me', auth, { role: 'owner' })).statusCode).toBe(400)
      expect((await call('PATCH', '/users/me', auth, { status: 'inactive' })).statusCode).toBe(400)
    })

    it('uma pessoa não altera os dados de outra: o usuário vem sempre do token', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      await call('PATCH', '/users/me', a.auth, { name: 'Só A muda' })
      expect((await call('GET', '/users/me', b.auth)).json().payload.name).toBe('Dono b')
    })
  })

  describe('PATCH /users/me/email', () => {
    it('com a senha atual troca o e-mail: o login passa a ser pelo novo', async () => {
      const env = freshEnv()
      const { auth, email } = await signup(env)
      const novo = `novo_${env}@teste.com`
      const res = await call('PATCH', '/users/me/email', auth, { email: `  ${novo.toUpperCase()} `, currentPassword: PASSWORD })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.email).toBe(novo)

      expect((await login(env, novo, PASSWORD)).statusCode).toBe(200)
      expect((await login(env, email, PASSWORD)).statusCode).toBe(401)
    })

    it('senha atual errada: 403, e o e-mail não muda', async () => {
      const env = freshEnv()
      const { auth, email } = await signup(env)
      const res = await call('PATCH', '/users/me/email', auth, { email: `novo_${env}@teste.com`, currentPassword: 'Errada123' })
      expect(res.statusCode).toBe(403)
      expect((await call('GET', '/users/me', auth)).json().payload.email).toBe(email)
    })

    it('e-mail que já é de outra conta: 409', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      const res = await call('PATCH', '/users/me/email', a.auth, { email: b.email, currentPassword: PASSWORD })
      expect(res.statusCode).toBe(409)
    })

    it('o mesmo e-mail de hoje: 400; e-mail inválido ou sem senha: 400', async () => {
      const { auth, email } = await signup(freshEnv())
      expect((await call('PATCH', '/users/me/email', auth, { email, currentPassword: PASSWORD })).statusCode).toBe(400)
      expect((await call('PATCH', '/users/me/email', auth, { email: 'nao-e-email', currentPassword: PASSWORD })).statusCode).toBe(400)
      expect((await call('PATCH', '/users/me/email', auth, { email: 'ok@teste.com' })).statusCode).toBe(400)
    })

    it('errar a senha demais bloqueia a conta (o token roubado não adivinha a senha)', async () => {
      const env = freshEnv()
      const { auth } = await signup(env)
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) {
        statuses.push((await call('PATCH', '/users/me/email', auth, { email: `x${i}_${env}@teste.com`, currentPassword: 'Errada123' })).statusCode)
      }
      expect(statuses.slice(0, 4)).toEqual([403, 403, 403, 403])
      expect(statuses.slice(4)).toEqual([429, 429])
    })
  })

  describe('POST /users/me/password', () => {
    const NOVA = 'NovaSenha456'

    it('com a senha antiga troca a senha e encerra TODAS as sessões', async () => {
      const env = freshEnv()
      const { auth, email, refreshToken } = await signup(env)
      const res = await call('POST', '/users/me/password', auth, { currentPassword: PASSWORD, newPassword: NOVA })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.message).toContain('Entre novamente')

      // A sessão antiga não renova mais, a senha antiga não entra, a nova entra.
      expect((await refresh(env, refreshToken)).statusCode).toBe(401)
      expect((await login(env, email, PASSWORD)).statusCode).toBe(401)
      expect((await login(env, email, NOVA)).statusCode).toBe(200)
    })

    it('senha antiga errada: 403, e nada muda', async () => {
      const env = freshEnv()
      const { auth, email, refreshToken } = await signup(env)
      const res = await call('POST', '/users/me/password', auth, { currentPassword: 'Errada123', newPassword: NOVA })
      expect(res.statusCode).toBe(403)
      expect((await login(env, email, PASSWORD)).statusCode).toBe(200)
      expect((await refresh(env, refreshToken)).statusCode).toBe(200)
    })

    it('senha nova fraca, igual à atual ou sem a antiga: 400', async () => {
      const { auth } = await signup(freshEnv())
      expect((await call('POST', '/users/me/password', auth, { currentPassword: PASSWORD, newPassword: 'fraca' })).statusCode).toBe(400)
      expect((await call('POST', '/users/me/password', auth, { currentPassword: PASSWORD, newPassword: PASSWORD })).statusCode).toBe(400)
      expect((await call('POST', '/users/me/password', auth, { newPassword: NOVA })).statusCode).toBe(400)
    })

    it('registra a troca na auditoria', async () => {
      const env = freshEnv()
      const { auth } = await signup(env)
      await call('POST', '/users/me/password', auth, { currentPassword: PASSWORD, newPassword: NOVA })
      const events = (await mongoConnection.getDatabase(env).collection('audit_logs').find({}).toArray()).map((e) => e.event)
      expect(events).toContain('password_changed')
    })
  })
})
