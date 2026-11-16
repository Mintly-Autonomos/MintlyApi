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
  person: { name: 'Dono Transf', phone: '11977777777' },
  password: 'Senha123',
  restaurantName: 'Restaurante Transf',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_transf_${++envCounter}`
const dec = (v: any): number => Number(v?.toString?.() ?? v ?? 0)

describe('Transferência entre contas e saldo inicial (S3.2, integração)', () => {
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
    const res = await app.inject({ method: 'POST', url: '/auth/signup', headers: { env }, payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` } })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId
    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })
    const db = mongoConnection.getDatabase(env)
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })
    const bank = await app.inject({ method: 'POST', url: '/financial-accounts', headers: auth, payload: { name: 'Nubank', type: 'bank', status: 'active' } })
    expect(bank.statusCode).toBe(201)
    const platform = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { name: 'iFood', type: 'platform', status: 'active', feePercent: 12, settlementDays: 30 },
    })
    expect(platform.statusCode).toBe(201)
    const revenue = await db.collection('financial_categories').insertOne({
      restaurantId, name: 'Vendas', type: 'revenue', behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit: { createdAt: new Date(), updatedAt: new Date() },
    })
    return { env, auth, db, restaurantId, cashId: String(cash!._id), bankId: bank.json().payload._id as string, platformId: platform.json().payload._id as string, revenueId: String(revenue.insertedId) }
  }

  const balance = async (db: any, id: string) => dec((await db.collection('financial_accounts').findOne({ _id: new ObjectId(id) })).availableBalance)
  const today = () => toLocalDay(new Date())
  const transfer = (auth: any, payload: any) => app.inject({ method: 'POST', url: '/financial-movements/transfers', headers: auth, payload })

  it('tira de uma conta e põe na outra: dois lançamentos ligados, sem taxa, já liquidados; caixa total igual', async () => {
    const { auth, db, platformId, bankId } = await setup()
    const res = await transfer(auth, { fromAccountId: platformId, toAccountId: bankId, amount: 1_500, date: today() })
    expect(res.statusCode).toBe(201)
    const { transferId, out, in: inn } = res.json().payload
    expect(transferId).toMatch(/^[0-9a-f]{24}$/)
    expect(out).toMatchObject({ direction: 'out', status: 'settled', grossValue: 1_500, feeValue: 0, netValue: 1_500, transferId, transferCounterpart: { _id: bankId, name: 'Nubank' } })
    expect(inn).toMatchObject({ direction: 'in', status: 'settled', grossValue: 1_500, netValue: 1_500, transferId, transferCounterpart: { _id: platformId, name: 'iFood' } })
    expect(out.title).toBe('Transferência para Nubank')
    expect(await balance(db, platformId)).toBe(-1_500)
    expect(await balance(db, bankId)).toBe(1_500)
    const cats = await db.collection('financial_categories').find({ systemKey: { $exists: true } }).toArray()
    expect(cats.map((c: any) => c.systemKey).sort()).toEqual(['transferIn', 'transferOut'])
    expect(cats.every((c: any) => c.operationalNature === 'nonOperational' && c.isSystem === true)).toBe(true)
  })

  it('mesma conta, valor zero ou conta inexistente → erro, nada gravado', async () => {
    const { auth, db, bankId } = await setup()
    expect((await transfer(auth, { fromAccountId: bankId, toAccountId: bankId, amount: 10, date: today() })).statusCode).toBe(400)
    expect((await transfer(auth, { fromAccountId: bankId, toAccountId: new ObjectId().toHexString(), amount: 10, date: today() })).statusCode).toBe(404)
    expect((await transfer(auth, { fromAccountId: bankId, toAccountId: bankId, amount: 0, date: today() })).statusCode).toBe(400)
    expect(await db.collection('financial_movements').countDocuments({})).toBe(0)
  })

  it('cancelar um lado cancela os dois e desfaz os saldos', async () => {
    const { auth, db, cashId, bankId } = await setup()
    const { out } = (await transfer(auth, { fromAccountId: cashId, toAccountId: bankId, amount: 300, date: today() })).json().payload
    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${out._id}/status`, headers: auth, payload: { status: 'cancelled' } })
    expect(res.statusCode).toBe(200)
    const both = await db.collection('financial_movements').find({ transferId: out.transferId }).toArray()
    expect(both.map((m: any) => m.status)).toEqual(['cancelled', 'cancelled'])
    expect(await balance(db, cashId)).toBe(0)
    expect(await balance(db, bankId)).toBe(0)
  })

  it('editar um lado da transferência → 409; lançar avulso numa categoria do sistema → 400', async () => {
    const { auth, db, cashId, bankId } = await setup()
    const { out } = (await transfer(auth, { fromAccountId: cashId, toAccountId: bankId, amount: 300, date: today() })).json().payload
    expect((await app.inject({ method: 'PATCH', url: `/financial-movements/${out._id}`, headers: auth, payload: { grossValue: 10 } })).statusCode).toBe(409)
    const sys = await db.collection('financial_categories').findOne({ systemKey: 'transferIn' })
    const avulso = await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: { direction: 'in', title: 'Pix', grossValue: 50, date: today(), accountId: bankId, categoryId: String(sys!._id), paymentMethod: 'pix' },
    })
    expect(avulso.statusCode).toBe(400)
  })

  it('saldo inicial: entra no saldo, troca sem duplicar e 0 remove', async () => {
    const { auth, db, bankId } = await setup()
    const put = (amount: number) => app.inject({ method: 'PUT', url: `/financial-accounts/${bankId}/opening-balance`, headers: auth, payload: { amount, date: '2026-05-01' } })
    const first = await put(18_500)
    expect(first.statusCode).toBe(200)
    expect(first.json().payload).toMatchObject({ direction: 'in', grossValue: 18_500, title: 'Saldo inicial · Nubank' })
    expect(await balance(db, bankId)).toBe(18_500)
    await put(20_000)
    expect(await balance(db, bankId)).toBe(20_000)
    const vivos = await db.collection('financial_movements').countDocuments({ 'account._id': bankId, status: { $ne: 'cancelled' } })
    expect(vivos).toBe(1)
    const removed = await put(0)
    expect(removed.json().payload).toBeNull()
    expect(await balance(db, bankId)).toBe(0)
  })

  it('o Resultado não vê transferência nem saldo inicial (nem nas linhas de não operacional)', async () => {
    const { auth, cashId, bankId } = await setup()
    await transfer(auth, { fromAccountId: cashId, toAccountId: bankId, amount: 700, date: today() })
    await app.inject({ method: 'PUT', url: `/financial-accounts/${bankId}/opening-balance`, headers: auth, payload: { amount: 5_000, date: today() } })
    const r = (await app.inject({ method: 'GET', url: `/reports/result?month=${toLocalMonth(new Date())}`, headers: auth })).json().payload
    expect(r.current).toMatchObject({ grossRevenue: 0, operatingExpenses: 0, nonOperatingIncome: 0, nonOperatingExpenses: 0, netProfit: 0 })
  })

  it('o Fluxo de caixa não conta transferência nem saldo inicial como entrada/saída; o caixa de hoje soma o saldo inicial', async () => {
    const { auth, cashId, bankId, revenueId } = await setup()
    await transfer(auth, { fromAccountId: cashId, toAccountId: bankId, amount: 700, date: today() })
    await app.inject({ method: 'PUT', url: `/financial-accounts/${bankId}/opening-balance`, headers: auth, payload: { amount: 5_000, date: today() } })
    await app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: { direction: 'in', title: 'Venda', grossValue: 100, date: today(), accountId: cashId, categoryId: revenueId, paymentMethod: 'cash' },
    })
    const cf = (await app.inject({ method: 'GET', url: '/reports/cash-flow?horizon=7', headers: auth })).json().payload
    expect(cf.cashToday).toBe(5_100)
    // Ontem = caixa de hoje − o que entrou hoje: só a venda (R$ 100) conta como entrada; o saldo inicial
    // e a transferência não (se contassem, o saldo de ontem seria R$ 100).
    expect(cf.realized.at(-1).balance).toBe(5_000)
    expect(cf.realized.every((p: any) => p.inflows <= 100 && p.outflows === 0)).toBe(true)
  })
})
