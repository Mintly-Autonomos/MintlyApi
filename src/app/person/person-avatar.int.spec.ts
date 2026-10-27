import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { AVATAR_MAX_BYTES } from 'mintly-lib'

// Integração real (Mongo em memória, replica set p/ a transação do signup): foto de perfil
// no cadastro, no retorno do login e na busca por nome de usuário.

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHhM3JQAAAABJRU5ErkJggg=='

let envCounter = 0
const freshEnv = () => `avatartest_${++envCounter}`

describe('Foto de perfil (integração)', () => {
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

  const signup = (env: string, email: string, avatar?: string) =>
    server.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: {
        person: { name: 'Ana Costa', phone: '11999990000', ...(avatar ? { avatar } : {}) },
        email,
        password: 'Senha123',
        restaurantName: 'Seoul Bird',
        termsAccepted: true,
      },
    })

  const login = (env: string, email: string) =>
    server.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password: 'Senha123' } })

  const getAvatar = (env: string, token: string, username: string) =>
    server.inject({
      method: 'GET',
      url: `/people/avatar/${encodeURIComponent(username)}`,
      headers: { env, authorization: `Bearer ${token}` },
    })

  it('signup grava a foto só em `people` e a devolve em user.person.avatar', async () => {
    const env = freshEnv()
    const res = await signup(env, 'ana@seoulbird.com', PNG)
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.user.person.avatar).toBe(PNG)

    const db = mongoConnection.getDatabase(env)
    const person = await db.collection('people').findOne({ name: 'Ana Costa' })
    expect(person?.avatar).toBe(PNG)
    const user = await db.collection('users').findOne({ email: 'ana@seoulbird.com' })
    expect(user?.person.avatar).toBeUndefined()
  })

  it('signup sem foto continua funcionando (avatar ausente)', async () => {
    const res = await signup(freshEnv(), 'sem-foto@seoulbird.com')
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.user.person.avatar).toBeUndefined()
  })

  it('signup aceita foto de ~1 MB (acima do bodyLimit padrão de 1 MiB do Fastify)', async () => {
    const base64 = 'A'.repeat(Math.floor((AVATAR_MAX_BYTES * 4) / 3) - 4)
    const res = await signup(freshEnv(), 'grande@seoulbird.com', `data:image/png;base64,${base64}`)
    expect(res.statusCode).toBe(201)
  })

  it('signup rejeita foto que não é imagem (400)', async () => {
    const res = await signup(freshEnv(), 'texto@seoulbird.com', 'data:text/html;base64,AAAA')
    expect(res.statusCode).toBe(400)
  })

  it('signup rejeita foto acima de 1 MB (400)', async () => {
    const base64 = 'A'.repeat(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 4096)
    const res = await signup(freshEnv(), 'enorme@seoulbird.com', `data:image/png;base64,${base64}`)
    expect(res.statusCode).toBe(400)
  })

  it('login devolve a foto em user.person.avatar', async () => {
    const env = freshEnv()
    await signup(env, 'login@seoulbird.com', PNG)
    const res = await login(env, 'login@seoulbird.com')
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.user.person.avatar).toBe(PNG)
  })

  it('login sem foto não traz o campo', async () => {
    const env = freshEnv()
    await signup(env, 'nofoto@seoulbird.com')
    const res = await login(env, 'nofoto@seoulbird.com')
    expect(res.json().payload.user.person.avatar).toBeUndefined()
  })

  it('GET /people/avatar/:username devolve a foto de quem é do mesmo restaurante', async () => {
    const env = freshEnv()
    const { payload } = (await signup(env, 'dono@seoulbird.com', PNG)).json()
    const res = await getAvatar(env, payload.accessToken, 'DONO@seoulbird.com')
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toEqual({ avatar: PNG })
  })

  it('GET /people/avatar/:username devolve avatar null sem foto ou e-mail inexistente', async () => {
    const env = freshEnv()
    const { payload } = (await signup(env, 'sofoto@seoulbird.com')).json()
    expect((await getAvatar(env, payload.accessToken, 'sofoto@seoulbird.com')).json().payload).toEqual({ avatar: null })
    expect((await getAvatar(env, payload.accessToken, 'nao-existe@seoulbird.com')).json().payload).toEqual({ avatar: null })
  })

  it('GET /people/avatar/:username não revela a foto de outro restaurante', async () => {
    const env = freshEnv()
    await signup(env, 'a@restaurante-a.com', PNG)
    const { payload } = (await signup(env, 'b@restaurante-b.com')).json()
    const res = await getAvatar(env, payload.accessToken, 'a@restaurante-a.com')
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toEqual({ avatar: null })
  })

  it('GET /people/avatar/:username exige autenticação (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/people/avatar/qualquer@seoulbird.com',
      headers: { env: freshEnv() },
    })
    expect(res.statusCode).toBe(401)
  })
})
