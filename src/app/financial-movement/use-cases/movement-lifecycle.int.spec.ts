import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../../financial-account/financial-account-repository'
import { FinancialMovementRepository } from '../financial-movement-repository'

const SIGNUP_BASE = {
  person: { name: 'Dono Ciclo', phone: '11966666666' },
  password: 'Senha123',
  restaurantName: 'Restaurante Ciclo',
  termsAccepted: true,
}

let envCounter = 0
const dec = (v: any): number => Number(v?.toString?.() ?? v ?? 0)

describe('Financial Movement lifecycle (Integration)', () => {
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

  async function setup () {
    const env = `int_cycle_${++envCounter}`
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId

    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })

    const db = mongoConnection.getDatabase(env)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const revenue = await db.collection('financial_categories').insertOne({
      restaurantId, name: 'Vendas', type: 'revenue', behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit,
    })
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })

    return { auth, db, restaurantId, cashId: String(cash!._id), revenueCatId: String(revenue.insertedId) }
  }

  async function createPlatform (auth: Record<string, string>, restaurantId: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { restaurantId, name: `iFood ${Math.random().toString(36).slice(2, 6)}`, type: 'platform', status: 'active', isDefault: false, feePercent: 10, settlementDays: 14, audit: { createdAt: new Date(), updatedAt: new Date() } },
    })
    expect(res.statusCode).toBe(201)
    return res.json().payload._id as string
  }

  const register = (auth: Record<string, string>, payload: Record<string, any>) =>
    app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload })

  async function balances (db: any, id: string) {
    const a = await db.collection('financial_accounts').findOne({ _id: new ObjectId(id) })
    return { available: dec(a.availableBalance), predicted: dec(a.predictedBalance) }
  }

  it('pending → settled move o valor do saldo previsto p/ o disponível', async () => {
    const { auth, db, restaurantId, revenueCatId } = await setup()
    const platformId = await createPlatform(auth, restaurantId)
    const reg = await register(auth, { direction: 'in', title: 'Venda app', grossValue: 200, date: '2026-06-16T00:00:00.000Z', accountId: platformId, categoryId: revenueCatId, paymentMethod: 'pix' })
    const movId = reg.json().payload._id
    expect((await balances(db, platformId))).toEqual({ available: 0, predicted: 180 })

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'settled' } })
    expect(res.statusCode).toBe(200)
    expect((await balances(db, platformId))).toEqual({ available: 180, predicted: 0 })
  })

  it('→ cancelled reverte o efeito no saldo', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const reg = await register(auth, { direction: 'in', title: 'Venda', grossValue: 50, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })
    const movId = reg.json().payload._id
    expect((await balances(db, cashId)).available).toBe(50)

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'cancelled' } })
    expect(res.statusCode).toBe(200)
    expect((await balances(db, cashId)).available).toBe(0)
  })

  it('edição de valor recalcula o saldo (reverte antigo + aplica novo)', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const reg = await register(auth, { direction: 'in', title: 'Venda', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })
    const movId = reg.json().payload._id
    expect((await balances(db, cashId)).available).toBe(100)

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}`, headers: auth, payload: { grossValue: 60 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.grossValue).toBe(60)
    expect((await balances(db, cashId)).available).toBe(60)
  })

  it('recompute-balances reconcilia o saldo a partir das movimentações', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    await register(auth, { direction: 'in', title: 'V1', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })
    await register(auth, { direction: 'in', title: 'V2', grossValue: 30, date: '2026-06-17T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })

    // corrompe o saldo de propósito
    await db.collection('financial_accounts').updateOne({ _id: new ObjectId(cashId) }, { $set: { availableBalance: 9999 } })

    const res = await app.inject({ method: 'POST', url: '/financial-movements/recompute-balances', headers: auth, payload: { accountId: cashId } })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toEqual({ availableBalance: 130, predictedBalance: 0 })
    expect((await balances(db, cashId)).available).toBe(130)
  })
})
