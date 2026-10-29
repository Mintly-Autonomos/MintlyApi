import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { ensureAllIndexes } from '../../infrastructure/db/indices'
import { buildServer } from '../../infrastructure/server/build-server'

const SIGNUP_BASE = {
  person: { name: 'Dono Import', phone: '11977777777' },
  password: 'Senha123',
  restaurantName: 'Restaurante Import',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_import_${++envCounter}`

const dec = (v: any): number => Number(v?.toString?.() ?? v ?? 0)

describe('POST /financial-movements/import (Integration)', () => {
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

    await ensureAllIndexes(env)

    const db = mongoConnection.getDatabase(env)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const base = { restaurantId, behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit }
    const revenue = await db.collection('financial_categories').insertOne({ ...base, name: 'Vendas', type: 'revenue' })
    const expense = await db.collection('financial_categories').insertOne({ ...base, name: 'Fornecedores', type: 'expense' })
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

  const row = (n: number, over: Record<string, any> = {}) => ({
    row: n,
    direction: 'in',
    title: `Venda ${n}`,
    grossValue: 100,
    date: '2026-06-16T00:00:00.000Z',
    paymentMethod: 'cash',
    ...over,
  })

  const post = (auth: Record<string, string>, payload: unknown) =>
    app.inject({ method: 'POST', url: '/financial-movements/import', headers: auth, payload: payload as any })

  const available = async (db: any, id: string) => {
    const a = await db.collection('financial_accounts').findOne({ _id: new ObjectId(id) })
    return dec(a.availableBalance)
  }

  it('importa o lote, devolve resultado por linha e ajusta o saldo', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const before = await available(db, cashId)

    const res = await post(auth, {
      idempotencyKey: 'arquivo-abc-12345',
      rows: [1, 2, 3].map((n) => row(n, { accountId: cashId, categoryId: revenueCatId })),
    })

    expect(res.statusCode).toBe(201)
    const body = res.json().payload
    expect(body).toMatchObject({ replayed: false, total: 3, created: 3, failed: 0 })
    expect(body.results.map((r: any) => [r.row, r.status])).toEqual([[1, 'created'], [2, 'created'], [3, 'created']])
    expect(await db.collection('financial_movements').countDocuments({})).toBe(3)
    expect(await available(db, cashId)).toBe(before + 300)
  })

  it('linha inválida, de conta inexistente ou de categoria trocada falha sozinha', async () => {
    const { auth, db, cashId, revenueCatId, expenseCatId } = await setup()
    const ok = { accountId: cashId, categoryId: revenueCatId }

    const res = await post(auth, {
      idempotencyKey: 'arquivo-misto-12345',
      rows: [
        row(1, ok),
        row(2, { ...ok, date: '28/10/2026' }),
        row(3, { ...ok, accountId: new ObjectId().toHexString() }),
        row(4, { accountId: cashId, categoryId: expenseCatId }), // entrada em categoria de despesa
        row(5, ok),
      ],
    })

    expect(res.statusCode).toBe(201)
    const body = res.json().payload
    expect(body).toMatchObject({ total: 5, created: 2, failed: 3 })
    const byRow = Object.fromEntries(body.results.map((r: any) => [r.row, r]))
    expect(byRow[1].status).toBe('created')
    expect(byRow[2]).toMatchObject({ status: 'failed', error: { code: 'VALIDATION_ERROR' } })
    expect(byRow[3]).toMatchObject({ status: 'failed', error: { code: 'NOT_FOUND' } })
    expect(byRow[4]).toMatchObject({ status: 'failed', error: { code: 'VALIDATION_ERROR' } })
    expect(byRow[5].status).toBe('created')
    expect(await db.collection('financial_movements').countDocuments({})).toBe(2)
  })

  it('linha repetida no mesmo lote vira DUPLICATE; o resto segue', async () => {
    const { auth, cashId, revenueCatId } = await setup()
    const same = { accountId: cashId, categoryId: revenueCatId, title: 'Venda igual' }

    const res = await post(auth, {
      idempotencyKey: 'arquivo-dup-123456',
      rows: [row(1, same), row(2, same), row(3, { accountId: cashId, categoryId: revenueCatId })],
    })

    const body = res.json().payload
    expect(body).toMatchObject({ created: 2, failed: 1 })
    expect(body.results[1]).toMatchObject({ row: 2, status: 'failed', error: { code: 'DUPLICATE' } })
  })

  it('reenviar a mesma chave devolve o resultado anterior sem gravar de novo', async () => {
    const { auth, db, cashId, revenueCatId } = await setup()
    const payload = {
      idempotencyKey: 'arquivo-replay-12345',
      rows: [1, 2].map((n) => row(n, { accountId: cashId, categoryId: revenueCatId })),
    }

    const first = await post(auth, payload)
    const balanceAfterFirst = await available(db, cashId)
    const again = await post(auth, payload)

    expect(first.statusCode).toBe(201)
    expect(again.statusCode).toBe(200)
    expect(again.json().payload).toMatchObject({ replayed: true, total: 2, created: 2 })
    expect(again.json().payload.results).toEqual(first.json().payload.results)
    expect(await db.collection('financial_movements').countDocuments({})).toBe(2)
    expect(await available(db, cashId)).toBe(balanceAfterFirst)
  })

  it('a mesma chave em outro restaurante é independente', async () => {
    const a = await setup()
    const b = await setup()
    const key = 'chave-compartilhada-1'

    const ra = await post(a.auth, { idempotencyKey: key, rows: [row(1, { accountId: a.cashId, categoryId: a.revenueCatId })] })
    const rb = await post(b.auth, { idempotencyKey: key, rows: [row(1, { accountId: b.cashId, categoryId: b.revenueCatId })] })

    expect(ra.json().payload.replayed).toBe(false)
    expect(rb.json().payload).toMatchObject({ replayed: false, created: 1 })
  })

  it('não grava em conta/categoria de outro restaurante', async () => {
    const a = await setup()
    const b = await setup()

    const res = await post(a.auth, {
      idempotencyKey: 'arquivo-tenant-1234',
      rows: [row(1, { accountId: b.cashId, categoryId: b.revenueCatId })],
    })

    expect(res.json().payload).toMatchObject({ created: 0, failed: 1 })
    expect(res.json().payload.results[0].error.code).toBe('NOT_FOUND')
    expect(await b.db.collection('financial_movements').countDocuments({})).toBe(0)
  })

  it.each([
    ['sem idempotencyKey', { rows: [{ row: 1 }] }],
    ['idempotencyKey curta', { idempotencyKey: 'curta', rows: [{ row: 1 }] }],
    ['rows vazio', { idempotencyKey: 'arquivo-vazio-1234', rows: [] }],
    ['rows ausente', { idempotencyKey: 'arquivo-vazio-1234' }],
    ['mais de 500 linhas', { idempotencyKey: 'arquivo-grande-1234', rows: Array.from({ length: 501 }, (_, i) => ({ row: i + 1 })) }],
  ])('rejeita o pedido inteiro com 400: %s', async (_nome, payload) => {
    const { auth } = await setup()
    const res = await post(auth, payload)
    expect(res.statusCode).toBe(400)
  })

  it('exige autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/financial-movements/import',
      headers: { env: freshEnv() },
      payload: { idempotencyKey: 'arquivo-anonimo-1', rows: [{ row: 1 }] },
    })
    expect(res.statusCode).toBe(401)
  })
})
