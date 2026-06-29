import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../financial-account/financial-account-repository'
import { FinancialMovementRepository } from './financial-movement-repository'

const SIGNUP_BASE = {
  person: { name: 'Dono Mov', phone: '11977777777' },
  password: 'Senha123',
  restaurantName: 'Restaurante Mov',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_mov_${++envCounter}`

/** Decimal128 | number -> number. */
const dec = (v: any): number => Number(v?.toString?.() ?? v ?? 0)

describe('Financial Movement (Integration)', () => {
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
    const env = freshEnv()
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

    // categorias de teste (revenue + expense)
    const revenue = await db.collection('financial_categories').insertOne({
      restaurantId,
      name: 'Vendas',
      type: 'revenue',
      behavior: 'variable',
      operationalNature: 'operational',
      status: 'active',
      isSystem: false,
      audit,
    })
    const expense = await db.collection('financial_categories').insertOne({
      restaurantId,
      name: 'Fornecedores',
      type: 'expense',
      behavior: 'variable',
      operationalNature: 'operational',
      status: 'active',
      isSystem: false,
      audit,
    })

    // conta Caixa default (cash)
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })

    return {
      auth,
      env,
      restaurantId,
      db,
      cashId: String(cash!._id),
      revenueCatId: String(revenue.insertedId),
      expenseCatId: String(expense.insertedId),
    }
  }

  async function createPlatformAccount (auth: Record<string, string>, restaurantId: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: {
        restaurantId,
        name: `iFood ${Math.random().toString(36).slice(2, 6)}`,
        type: 'platform',
        status: 'active',
        isDefault: false,
        feePercent: 12,
        settlementDays: 30,
        audit: { createdAt: new Date(), updatedAt: new Date() },
      },
    })
    expect(res.statusCode).toBe(201)
    return res.json().payload._id as string
  }

  const baseMovement = (over: Record<string, any>) => ({
    direction: 'in',
    title: 'Venda balcão',
    grossValue: 100,
    date: '2026-06-16T00:00:00.000Z',
    paymentMethod: 'cash',
    ...over,
  })

  async function accountBalances (db: any, id: string) {
    const a = await db.collection('financial_accounts').findOne({ _id: new ObjectId(id) })
    return { available: dec(a.availableBalance), predicted: dec(a.predictedBalance) }
  }

  it('entrada em conta cash → settled, debita no saldo disponível pelo líquido (=bruto)', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: baseMovement({ accountId: cashId, categoryId: revenueCatId }),
    })
    expect(res.statusCode).toBe(201)
    const body = res.json().payload
    expect(body.status).toBe('settled')
    expect(body.netValue).toBe(100)
    expect((await accountBalances(db, cashId)).available).toBe(100)
  })

  it('entrada em conta platform → pending, fee/net + data prevista, vai p/ saldo previsto', async () => {
    const { auth, db, restaurantId, revenueCatId } = await setup()
    const platformId = await createPlatformAccount(auth, restaurantId)
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: baseMovement({ accountId: platformId, categoryId: revenueCatId, grossValue: 100, paymentMethod: 'pix' }),
    })
    expect(res.statusCode).toBe(201)
    const body = res.json().payload
    expect(body.status).toBe('pending')
    expect(body.feeValue).toBe(12)
    expect(body.netValue).toBe(88)
    expect(body.predictedReceiptDate).toBeDefined()
    const bal = await accountBalances(db, platformId)
    expect(bal.predicted).toBe(88)
    expect(bal.available).toBe(0)
  })

  it('saída em conta cash → debita o bruto do saldo disponível', async () => {
    const { auth, db, cashId, expenseCatId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: baseMovement({ direction: 'out', title: 'Compra', grossValue: 40, accountId: cashId, categoryId: expenseCatId }),
    })
    expect(res.statusCode).toBe(201)
    expect((await accountBalances(db, cashId)).available).toBe(-40)
  })

  it('bloqueia duplicidade (<2min) com 409 e libera com confirmDuplicate', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const payload = baseMovement({ accountId: cashId, categoryId: revenueCatId, title: 'Dup', grossValue: 77 })

    expect((await app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: { ...payload, confirmDuplicate: true } })).statusCode).toBe(201)
  })

  it('rejeita entrada com categoria de despesa (categoria×direção) → 400', async () => {
    const { auth, cashId, expenseCatId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: baseMovement({ accountId: cashId, categoryId: expenseCatId }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('conta inexistente → 404', async () => {
    const { auth, revenueCatId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: baseMovement({ accountId: new ObjectId().toHexString(), categoryId: revenueCatId }),
    })
    expect(res.statusCode).toBe(404)
  })

  it('listagem retorna do mais recente ao mais antigo e respeita o tenant', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    await app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: baseMovement({ accountId: cashId, categoryId: revenueCatId, title: 'Antiga', date: '2026-06-01T00:00:00.000Z' }) })
    await app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: baseMovement({ accountId: cashId, categoryId: revenueCatId, title: 'Nova', date: '2026-06-20T00:00:00.000Z' }) })

    const res = await app.inject({ method: 'GET', url: '/financial-movements', headers: auth })
    expect(res.statusCode).toBe(200)
    const list = res.json().payload
    expect(list.length).toBe(2)
    expect(list[0].title).toBe('Nova')
    expect(list[1].title).toBe('Antiga')
  })

  // MIN-69: saída com fornecedor + NF; sem fee/net (net = bruto); débito.
  it('saída registra counterparty (supplier) e fiscalNote, sem fee (net = bruto)', async () => {
    const { auth, db, cashId, expenseCatId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: baseMovement({
        direction: 'out',
        title: 'Compra de insumos',
        grossValue: 80,
        accountId: cashId,
        categoryId: expenseCatId,
        counterparty: { name: 'Distribuidora X', kind: 'supplier' },
        fiscalNote: 'NF-12345',
      }),
    })
    expect(res.statusCode).toBe(201)
    const body = res.json().payload
    expect(body.counterparty).toMatchObject({ name: 'Distribuidora X', kind: 'supplier' })
    expect(body.fiscalNote).toBe('NF-12345')
    expect(body.netValue).toBe(80)
    expect(body.feeValue).toBe(0)
    expect((await accountBalances(db, cashId)).available).toBe(-80)
  })
})
