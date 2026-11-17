import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../financial-account/financial-account-repository'
import { FinancialMovementRepository } from './financial-movement-repository'
import { toLocalDay, toLocalMonth } from '../reports/shared/period'

const SIGNUP_BASE = {
  person: { name: 'Dona Confeitaria', phone: '11955555555' },
  password: 'Senha123',
  restaurantName: 'Confeitaria Encomendas',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_enc_${++envCounter}`

describe('Encomendas, hora da venda e número de vendas (S3.4, integração)', () => {
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
    const res = await app.inject({ method: 'POST', url: '/auth/signup', headers: { env }, payload: { ...SIGNUP_BASE, email: `dona_${env}@teste.com` } })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId
    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })
    const db = mongoConnection.getDatabase(env)
    const bank = await app.inject({ method: 'POST', url: '/financial-accounts', headers: auth, payload: { name: 'Nubank', type: 'bank', status: 'active' } })
    expect(bank.statusCode).toBe(201)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const revenue = await db.collection('financial_categories').insertOne({
      restaurantId, name: 'Vendas', type: 'revenue', behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit,
    })
    const expense = await db.collection('financial_categories').insertOne({
      restaurantId, name: 'Embalagens', type: 'expense', behavior: 'variable', operationalNature: 'operational', dreGroup: 'cmv', status: 'active', isSystem: false, audit,
    })
    return { auth, db, bankId: bank.json().payload._id as string, revenueId: String(revenue.insertedId), expenseId: String(expense.insertedId) }
  }

  const today = () => toLocalDay(new Date())
  const post = (auth: any, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: payload as any })
  const entrada = (s: { bankId: string; revenueId: string }, extra: Record<string, unknown> = {}) => ({
    direction: 'in', title: 'Venda', grossValue: 100, date: today(), accountId: s.bankId, categoryId: s.revenueId, paymentMethod: 'pix', ...extra,
  })
  const stored = async (db: any, id: string) => db.collection('financial_movements').findOne({ _id: new ObjectId(id) })

  it('a entrada guarda canal Encomendas, hora e número de vendas', async () => {
    const s = await setup()
    const r = await post(s.auth, entrada(s, { channel: 'orders', saleTime: '15:40', salesCount: 42 }))
    expect(r.statusCode).toBe(201)
    const p = r.json().payload
    expect(p).toMatchObject({ channel: 'orders', saleTime: '15:40', salesCount: 42 })
    expect(await stored(s.db, p._id)).toMatchObject({ channel: 'orders', saleTime: '15:40', salesCount: 42 })

    const sem = (await post(s.auth, entrada(s, { title: 'Venda sem hora' }))).json().payload
    const doc = await stored(s.db, sem._id)
    expect(doc.saleTime).toBeUndefined()
    expect(doc.salesCount).toBeUndefined()
  })

  it('recusa hora ou número de vendas fora do formato, e em saída', async () => {
    const s = await setup()
    expect((await post(s.auth, entrada(s, { saleTime: '25:00' }))).statusCode).toBe(400)
    expect((await post(s.auth, entrada(s, { saleTime: '9h' }))).statusCode).toBe(400)
    expect((await post(s.auth, entrada(s, { salesCount: 0 }))).statusCode).toBe(400)
    expect((await post(s.auth, entrada(s, { salesCount: 2.5 }))).statusCode).toBe(400)
    const saida = { direction: 'out', title: 'Caixas', grossValue: 50, date: today(), accountId: s.bankId, categoryId: s.expenseId, paymentMethod: 'pix' }
    const r = await post(s.auth, { ...saida, saleTime: '10:00' })
    expect(r.statusCode).toBe(400)
    expect(r.json().message ?? JSON.stringify(r.json())).toMatch(/só valem para entradas/)
    expect((await post(s.auth, { ...saida, salesCount: 3 })).statusCode).toBe(400)
    expect((await post(s.auth, { ...saida, channel: 'orders' })).statusCode).toBe(201)
  })

  it('edição: ausente mantém, valor troca, null limpa', async () => {
    const s = await setup()
    const id = (await post(s.auth, entrada(s, { saleTime: '09:00', salesCount: 10 }))).json().payload._id
    const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: payload as any })

    expect((await patch({ title: 'Fechamento da manhã' })).statusCode).toBe(200)
    expect(await stored(s.db, id)).toMatchObject({ title: 'Fechamento da manhã', saleTime: '09:00', salesCount: 10 })

    expect((await patch({ saleTime: '11:30', salesCount: 12, channel: 'orders' })).statusCode).toBe(200)
    expect(await stored(s.db, id)).toMatchObject({ saleTime: '11:30', salesCount: 12, channel: 'orders' })

    expect((await patch({ saleTime: null, salesCount: null })).statusCode).toBe(200)
    const doc = await stored(s.db, id)
    expect(doc.saleTime).toBeUndefined()
    expect(doc.salesCount).toBeUndefined()
    expect(doc.channel).toBe('orders')

    expect((await patch({ saleTime: '24:10' })).statusCode).toBe(400)
  })

  it('a importação aceita os campos novos', async () => {
    const s = await setup()
    const r = await app.inject({
      method: 'POST',
      url: '/financial-movements/import',
      headers: s.auth,
      payload: { idempotencyKey: `enc-${Date.now()}`, rows: [{ row: 1, ...entrada(s, { channel: 'orders', saleTime: '18:15', salesCount: 3 }) }] } as any,
    })
    expect(r.statusCode).toBe(201)
    const res = r.json().payload
    expect(res.created).toBe(1)
    expect(await stored(s.db, res.results[0].movement._id)).toMatchObject({ channel: 'orders', saleTime: '18:15', salesCount: 3 })
  })

  it('Custos filtra por Encomendas (receita e custos marcados como encomenda)', async () => {
    const s = await setup()
    await post(s.auth, entrada(s, { grossValue: 600, channel: 'orders' }))
    await post(s.auth, entrada(s, { grossValue: 400 }))
    await post(s.auth, { direction: 'out', title: 'Caixas de bolo', grossValue: 80, date: today(), accountId: s.bankId, categoryId: s.expenseId, paymentMethod: 'pix', channel: 'orders' })
    await post(s.auth, { direction: 'out', title: 'Copos', grossValue: 30, date: today(), accountId: s.bankId, categoryId: s.expenseId, paymentMethod: 'pix', channel: 'dineIn' })
    const month = toLocalMonth(new Date())
    const get = (q: string) => app.inject({ method: 'GET', url: `/reports/expenses?month=${month}${q}`, headers: s.auth })

    const enc = (await get('&channel=orders')).json().payload
    expect(enc.channel).toBe('orders')
    expect(enc.revenue.current).toBe(600)
    expect(enc.items.map((i: any) => [i.name, i.amount])).toEqual([['Embalagens', 80]])

    const salao = (await get('&channel=dineIn')).json().payload
    expect(salao.revenue.current).toBe(400)

    const geral = (await get('')).json().payload
    expect(geral.revenue.current).toBe(1_000)

    const ruim = await get('&channel=drive')
    expect(ruim.statusCode).toBe(400)
  })
})
