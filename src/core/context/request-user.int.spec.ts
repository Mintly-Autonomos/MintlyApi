import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { verifyJwt } from '../hooks/verify-jwt'
import { getRequestUser } from './request-user'

let envCounter = 0
const freshEnv = () => `int_request_user_${++envCounter}`

/**
 * Prova com o JWT de verdade (não com claims inventados): o token gerado no cadastro/login passa pelo verify-jwt
 * e o que ele anexa ao request é o que o getRequestUser precisa entender (o Valkyrie devolve cada claim como lista).
 */
describe('getRequestUser com o token real (Integration)', () => {
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

  const requestComToken = (env: string, accessToken: string) =>
    ({ headers: { env, authorization: `Bearer ${accessToken}` } }) as any

  it('dono: o token do cadastro vira um RequestUser com texto (não lista)', async () => {
    const env = freshEnv()
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: 'Davi Lee', phone: '11977777777' }, password: 'Senha123', restaurantName: 'Cantina', termsAccepted: true, email: `dono_${env}@teste.com` },
    })
    expect(signup.statusCode).toBe(201)
    const { accessToken, user } = signup.json().payload

    const request = requestComToken(env, accessToken)
    await verifyJwt(request)
    // o formato que o Valkyrie entrega de fato: cada claim é uma lista
    expect(Array.isArray(request.jwtClaims.claims.role)).toBe(true)

    const me = getRequestUser(request)
    expect(me).toMatchObject({
      userId: user._id,
      name: 'Davi Lee',
      email: `dono_${env}@teste.com`,
      restaurantId: user.restaurantId,
      role: 'owner',
      status: 'active',
    })
    expect(me.role === 'owner').toBe(true)
  })

  it('funcionário: o token do login traz role member', async () => {
    const env = freshEnv()
    const ownerEmail = `dono_${env}@teste.com`
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: 'Dono', phone: '11977777777' }, password: 'Senha123', restaurantName: 'Cantina', termsAccepted: true, email: ownerEmail },
    })
    const owner = signup.json().payload
    const memberEmail = `func_${env}@teste.com`
    const created = await app.inject({
      method: 'POST',
      url: '/restaurants/me/members',
      headers: { env, authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Ana Garçom', email: memberEmail, password: 'Func12345' },
    })
    expect(created.statusCode).toBe(201)
    const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email: memberEmail, password: 'Func12345' } })
    expect(login.statusCode).toBe(200)

    const request = requestComToken(env, login.json().payload.accessToken)
    await verifyJwt(request)
    expect(getRequestUser(request)).toMatchObject({
      name: 'Ana Garçom',
      email: memberEmail,
      restaurantId: owner.user.restaurantId,
      role: 'member',
      status: 'active',
    })
  })
})
