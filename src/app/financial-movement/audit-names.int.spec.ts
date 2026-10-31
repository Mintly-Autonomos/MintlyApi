import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../financial-account/financial-account-repository'
import { FinancialMovementRepository } from './financial-movement-repository'

let envCounter = 0
const freshEnv = () => `int_audit_${++envCounter}`

describe('Nome de quem criou/alterou nas respostas (Integration)', () => {
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

  async function signup (name: string) {
    const env = freshEnv()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name, phone: '11977777777' }, email: `dono_${env}@teste.com`, password: 'Senha123', restaurantName: 'Resto', termsAccepted: true },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    await new FinancialAccountRepository().createIndexes({ env, restaurantId: user.restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId: user.restaurantId })
    const db = mongoConnection.getDatabase(env)
    const cash = await db.collection('financial_accounts').findOne({ restaurantId: user.restaurantId, isDefault: true })
    const category = await db.collection('financial_categories').insertOne({
      restaurantId: user.restaurantId,
      name: 'Vendas',
      type: 'revenue',
      behavior: 'variable',
      operationalNature: 'operational',
      status: 'active',
      isSystem: false,
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })
    return {
      env,
      db,
      user,
      auth: { env, authorization: `Bearer ${accessToken}` },
      cashId: String(cash!._id),
      categoryId: String(category.insertedId),
    }
  }

  it('a listagem de movimentações traz o NOME de quem criou (e o id continua lá)', async () => {
    const { auth, user, cashId, categoryId } = await signup('Davi Lee')
    const created = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: { direction: 'in', title: 'Venda', grossValue: 100, date: '2026-06-16T00:00:00.000Z', paymentMethod: 'cash', accountId: cashId, categoryId },
    })
    expect(created.statusCode).toBe(201)

    const list = await app.inject({ method: 'GET', url: '/financial-movements', headers: auth })

    expect(list.statusCode).toBe(200)
    const [mov] = list.json().payload
    expect(mov.audit.createdBy).toBe(user.id ?? user._id)
    expect(mov.audit.createdByName).toBe('Davi Lee')
    expect(mov.audit.updatedByName).toBe('Davi Lee')
  })

  it('contas (controller genérico): nome em audit e no histórico', async () => {
    const { auth, cashId } = await signup('Ana Costa')
    const created = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { name: 'Itau', type: 'bank', status: 'active' },
    })
    expect(created.statusCode).toBe(201)
    const accountId = created.json().payload._id as string
    // define como padrão: grava uma entrada no histórico com o id de quem fez
    const def = await app.inject({ method: 'PATCH', url: `/financial-accounts/${accountId}/default`, headers: auth })
    expect(def.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })
    const itau = list.json().payload.find((a: any) => a.name === 'Itau')
    expect(itau.audit.createdByName).toBe('Ana Costa')
    expect(itau.history.every((h: any) => h.byName === 'Ana Costa')).toBe(true)
    expect(itau.history.length).toBeGreaterThan(0)
    expect(cashId).toBeTruthy()
  })

  it('só olha usuários do mesmo restaurante: o id de usuário de outro restaurante não vira nome', async () => {
    const { auth, db, cashId, categoryId } = await signup('Dono A')
    const created = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: { direction: 'in', title: 'Venda', grossValue: 10, date: '2026-06-16T00:00:00.000Z', paymentMethod: 'cash', accountId: cashId, categoryId },
    })
    expect(created.statusCode).toBe(201)
    const foreignId = new ObjectId()
    await db.collection('users').insertOne({ _id: foreignId, person: { name: 'Intruso' }, restaurantId: 'outro-restaurante' })
    await db.collection('financial_movements').updateMany({}, { $set: { 'audit.createdBy': String(foreignId) } })

    const list = await app.inject({ method: 'GET', url: '/financial-movements', headers: auth })

    const [mov] = list.json().payload
    expect(mov.audit.createdBy).toBe(String(foreignId))
    expect(mov.audit.createdByName).toBeUndefined()
  })
})
