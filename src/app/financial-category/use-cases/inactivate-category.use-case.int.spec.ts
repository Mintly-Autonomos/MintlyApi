import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { FinancialCategoryRepository } from '../financial-category-repository'

const SIGNUP_BASE = {
  person: { name: 'Dono Inativacao Categoria', phone: '11966666666' },
  password: 'Senha123',
  restaurantName: 'Restaurante Inativacao Categoria',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_cat_inactivate_${++envCounter}`

describe('PATCH /financial-categories/:id/inactivate + /reactivate', () => {
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

  async function setup (env: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    await new FinancialCategoryRepository().createIndexes({ env, restaurantId: user.restaurantId })
    return { auth, restaurantId: user.restaurantId as string }
  }

  async function createCategory (auth: Record<string, string>, restaurantId: string, overrides: Record<string, any> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/financial-categories',
      headers: auth,
      payload: {
        restaurantId,
        name: `Categoria ${Math.random().toString(36).slice(2, 8)}`,
        type: 'revenue',
        behavior: 'variable',
        operationalNature: 'operational',
        status: 'active',
        isSystem: false,
        audit: { createdAt: new Date(), updatedAt: new Date() },
        ...overrides,
      },
    })
    expect(res.statusCode).toBe(201)
    return res.json().payload._id as string
  }

  function inactivate (auth: Record<string, string>, id: string) {
    return app.inject({ method: 'PATCH', url: `/financial-categories/${id}/inactivate`, headers: auth })
  }

  function reactivate (auth: Record<string, string>, id: string) {
    return app.inject({ method: 'PATCH', url: `/financial-categories/${id}/reactivate`, headers: auth })
  }

  it('inativa uma categoria custom ativa → 200', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    const id = await createCategory(auth, restaurantId)

    const res = await inactivate(auth, id)

    expect(res.statusCode).toBe(200)
  })

  it('inativa uma categoria isSystem (livre — sem guard de saldo, diferente da conta) → 200', async () => {
    const env = freshEnv()
    const { auth } = await setup(env)
    const list = await app.inject({ method: 'GET', url: '/financial-categories', headers: auth })
    const [systemCategory] = list.json().payload

    const res = await inactivate(auth, systemCategory._id)

    expect(res.statusCode).toBe(200)
  })

  it('é idempotente: inativar duas vezes seguidas retorna 200 nas duas', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    const id = await createCategory(auth, restaurantId)

    const first = await inactivate(auth, id)
    const second = await inactivate(auth, id)

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
  })

  it('reativa uma categoria inativa → 200, e passa a aparecer com status active', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    const id = await createCategory(auth, restaurantId)
    await inactivate(auth, id)

    const res = await reactivate(auth, id)

    expect(res.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/financial-categories', headers: auth })
    const reactivated = (list.json().payload as Array<any>).find(c => c._id === id)
    expect(reactivated.status).toBe('active')
  })

  it('retorna 404 ao tentar inativar uma categoria inexistente', async () => {
    const env = freshEnv()
    const { auth } = await setup(env)

    const res = await inactivate(auth, '507f1f77bcf86cd799439011')

    expect(res.statusCode).toBe(404)
  })

  it('isola por tenant: não inativa categoria de outro restaurante (404)', async () => {
    const env1 = freshEnv()
    const env2 = freshEnv()
    const { auth: auth1, restaurantId: rid1 } = await setup(env1)
    const { auth: auth2 } = await setup(env2)
    const idFromRestaurant1 = await createCategory(auth1, rid1)

    const res = await inactivate(auth2, idFromRestaurant1)

    expect(res.statusCode).toBe(404)
  })
})
