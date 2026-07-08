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
      payload: { restaurantId, name: `iFood ${Math.random().toString(36).slice(2, 6)}`, type: 'platform', status: 'active', feePercent: 10, settlementDays: 14, audit: { createdAt: new Date(), updatedAt: new Date() } },
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

  const audit = () => ({ createdAt: new Date(), updatedAt: new Date() })

  it('register: conta inativa → 409 e categoria inexistente → 404', async () => {
    const { auth, db, restaurantId, cashId, revenueCatId } = await setup()
    const inactive = await db.collection('financial_accounts').insertOne({
      restaurantId,
      name: 'Inativa',
      type: 'cash',
      status: 'inactive',
      isDefault: false,
      availableBalance: 0,
      predictedBalance: 0,
      audit: audit(),
    })
    expect((await register(auth, { direction: 'in', title: 'X', grossValue: 10, date: '2026-06-16T00:00:00.000Z', accountId: String(inactive.insertedId), categoryId: revenueCatId, paymentMethod: 'cash' })).statusCode).toBe(409)
    expect((await register(auth, { direction: 'in', title: 'X', grossValue: 10, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: new ObjectId().toHexString(), paymentMethod: 'cash' })).statusCode).toBe(404)
  })

  it('change-status: status inválido → 409, id inexistente → 404, mesmo status → no-op', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 20, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id
    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'xpto' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${new ObjectId().toHexString()}/status`, headers: auth, payload: { status: 'settled' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'settled' } })).statusCode).toBe(200)
  })

  it('update: id inexistente → 404, troca de categoria, mover p/ conta inativa → 409', async () => {
    const { auth, db, restaurantId, cashId, revenueCatId } = await setup()
    const rev2 = await db.collection('financial_categories').insertOne({
      restaurantId,
      name: 'Outra Receita',
      type: 'revenue',
      behavior: 'variable',
      operationalNature: 'operational',
      status: 'active',
      isSystem: false,
      audit: audit(),
    })
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 30, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id

    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${new ObjectId().toHexString()}`, headers: auth, payload: { grossValue: 5 } })).statusCode).toBe(404)

    const cat = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}`, headers: auth, payload: { categoryId: String(rev2.insertedId) } })
    expect(cat.statusCode).toBe(200)
    expect(cat.json().payload.category._id).toBe(String(rev2.insertedId))

    const inactive = await db.collection('financial_accounts').insertOne({
      restaurantId,
      name: 'Inat',
      type: 'cash',
      status: 'inactive',
      isDefault: false,
      availableBalance: 0,
      predictedBalance: 0,
      audit: audit(),
    })
    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}`, headers: auth, payload: { accountId: String(inactive.insertedId) } })).statusCode).toBe(409)
  })

  it('recompute: accountId inválido → 404 e soma movimentação pendente no saldo previsto', async () => {
    const { auth, restaurantId, revenueCatId } = await setup()
    expect((await app.inject({ method: 'POST', url: '/financial-movements/recompute-balances', headers: auth, payload: { accountId: 'xpto' } })).statusCode).toBe(404)

    const platformId = await createPlatform(auth, restaurantId)
    await register(auth, { direction: 'in', title: 'P', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: platformId, categoryId: revenueCatId, paymentMethod: 'pix' })
    const res = await app.inject({ method: 'POST', url: '/financial-movements/recompute-balances', headers: auth, payload: { accountId: platformId } })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toEqual({ availableBalance: 0, predictedBalance: 90 })
  })

  it('listagem com busca textual (q) e filtro de período', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    await register(auth, { direction: 'in', title: 'Pizza Margherita', grossValue: 50, date: '2026-06-10T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })
    await register(auth, { direction: 'in', title: 'Refrigerante', grossValue: 8, date: '2026-07-10T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })

    const r1 = await app.inject({ method: 'GET', url: '/financial-movements?q=pizza', headers: auth })
    expect(r1.json().payload.length).toBe(1)
    expect(r1.json().payload[0].title).toBe('Pizza Margherita')

    const r2 = await app.inject({ method: 'GET', url: '/financial-movements?dateFrom=2026-07-01&dateTo=2026-07-31', headers: auth })
    expect(r2.json().payload.length).toBe(1)
    expect(r2.json().payload[0].title).toBe('Refrigerante')
  })

  it('ids inválidos (não-ObjectId) → 404 em register/status/update', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    expect((await register(auth, { direction: 'in', title: 'X', grossValue: 1, date: '2026-06-16T00:00:00.000Z', accountId: 'xpto', categoryId: revenueCatId, paymentMethod: 'cash' })).statusCode).toBe(404)
    expect((await register(auth, { direction: 'in', title: 'X', grossValue: 1, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: 'xpto', paymentMethod: 'cash' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: '/financial-movements/xpto/status', headers: auth, payload: { status: 'settled' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: '/financial-movements/xpto', headers: auth, payload: { grossValue: 5 } })).statusCode).toBe(404)
  })

  it('register aceita status, origin e descrição customizados', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const res = await register(auth, { direction: 'in', title: 'Boleto futuro', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'boleto', status: 'pending', origin: 'manual', description: 'pagamento agendado' })
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.status).toBe('pending')
    expect(res.json().payload.description).toBe('pagamento agendado')
  })

  it('edição em conta platform recalcula fee/net', async () => {
    const { auth, restaurantId, revenueCatId } = await setup()
    const platformId = await createPlatform(auth, restaurantId)
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: platformId, categoryId: revenueCatId, paymentMethod: 'pix' })).json().payload._id
    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}`, headers: auth, payload: { grossValue: 200 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.netValue).toBe(180)
  })

  it('listagem com paginação explícita (page/size)', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    await register(auth, { direction: 'in', title: 'A', grossValue: 10, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })
    const res = await app.inject({ method: 'GET', url: '/financial-movements?page=1&size=5', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().pagination.totalItems).toBe(1)
  })

  it('body ausente: status sem body → 409; recompute sem body → 404', async () => {
    const { auth } = await setup()
    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${new ObjectId().toHexString()}/status`, headers: auth })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/financial-movements/recompute-balances', headers: auth })).statusCode).toBe(404)
  })

  it('register com counterparty + fiscalNote na entrada', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const res = await register(auth, { direction: 'in', title: 'V', grossValue: 20, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'pix', counterparty: { name: 'Cliente', kind: 'client' }, fiscalNote: 'NF-1' })
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.counterparty.name).toBe('Cliente')
    expect(res.json().payload.fiscalNote).toBe('NF-1')
  })

  it('edição múltipla: status + counterparty + fiscalNote + descrição', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 40, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id
    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}`, headers: auth, payload: { status: 'pending', counterparty: { name: 'Cliente', kind: 'client' }, fiscalNote: 'NF-9', description: 'obs' } })
    expect(res.statusCode).toBe(200)
    const p = res.json().payload
    expect(p.status).toBe('pending')
    expect(p.counterparty.name).toBe('Cliente')
    expect(p.fiscalNote).toBe('NF-9')
    expect(p.description).toBe('obs')
  })

  it('change-status: settled → pending move do disponível p/ o previsto', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 70, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id
    expect((await balances(db, cashId)).available).toBe(70)
    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'pending' } })
    expect(res.statusCode).toBe(200)
    expect(await balances(db, cashId)).toEqual({ available: 0, predicted: 70 })
  })

  it('recompute ignora canceladas e soma só as liquidadas', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const m1 = (await register(auth, { direction: 'in', title: 'V1', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id
    await register(auth, { direction: 'in', title: 'V2', grossValue: 50, date: '2026-06-17T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })
    await app.inject({ method: 'PATCH', url: `/financial-movements/${m1}/status`, headers: auth, payload: { status: 'cancelled' } })
    const res = await app.inject({ method: 'POST', url: '/financial-movements/recompute-balances', headers: auth, payload: { accountId: cashId } })
    expect(res.json().payload).toEqual({ availableBalance: 50, predictedBalance: 0 })
  })

  it('edição trocando de conta move o saldo entre as contas', async () => {
    const { auth, db, restaurantId, cashId, revenueCatId } = await setup()
    const acc2 = await db.collection('financial_accounts').insertOne({
      restaurantId,
      name: 'Conta 2',
      type: 'cash',
      status: 'active',
      isDefault: false,
      availableBalance: 0,
      predictedBalance: 0,
      audit: audit(),
    })
    const acc2Id = String(acc2.insertedId)
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 30, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id
    expect((await balances(db, cashId)).available).toBe(30)

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}`, headers: auth, payload: { accountId: acc2Id } })
    expect(res.statusCode).toBe(200)
    expect((await balances(db, cashId)).available).toBe(0)
    expect((await balances(db, acc2Id)).available).toBe(30)
  })

  it('change-status: cancelled → settled reaplica o efeito no saldo', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const movId = (await register(auth, { direction: 'in', title: 'V', grossValue: 25, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: revenueCatId, paymentMethod: 'cash' })).json().payload._id
    await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'cancelled' } })
    expect((await balances(db, cashId)).available).toBe(0)
    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${movId}/status`, headers: auth, payload: { status: 'settled' } })
    expect(res.statusCode).toBe(200)
    expect((await balances(db, cashId)).available).toBe(25)
  })

  it('recompute: conta inexistente (id válido) → 404', async () => {
    const { auth } = await setup()
    const res = await app.inject({ method: 'POST', url: '/financial-movements/recompute-balances', headers: auth, payload: { accountId: new ObjectId().toHexString() } })
    expect(res.statusCode).toBe(404)
  })
})
