import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { toDecimal128 } from '../../core/money/money'
import { addMonths, toLocalMonth } from '../reports/shared/period'
import { resultScenario } from '../reports/result/result-scenario'

let envCounter = 0
const freshEnv = () => `int_overview_${++envCounter}`

describe('GET /dashboard/overview (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance
  const M = addMonths(toLocalMonth(new Date()), -1)

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

  async function signup (env: string, tag = 'a') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `ov_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  async function plant (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const { categories, movements } = resultScenario(M, restaurantId)
    await db.collection('financial_categories').insertMany(categories)
    await db.collection('financial_movements').insertMany(movements)
    await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })
  }
  const getJson = async (auth: Record<string, string>, url: string) => (await app.inject({ method: 'GET', url, headers: auth })).json().payload

  it('mesmos números das telas de origem (DRE, Custos, Fluxo)', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const [o, result, expenses, cash] = await Promise.all([
      getJson(auth, `/dashboard/overview?month=${M}`),
      getJson(auth, `/reports/result?month=${M}`),
      getJson(auth, `/reports/expenses?month=${M}`),
      getJson(auth, '/reports/cash-flow?horizon=30'),
    ])

    expect(o.referenceMonth).toBe(M)
    expect(o.cards.netProfit.amount).toBe(result.current.netProfit)
    expect(o.cards.revenue.amount).toBe(result.current.grossRevenue)
    expect(o.profitWaterfall).toEqual({ grossRevenue: result.current.grossRevenue, taxes: result.current.taxes, cmv: result.current.cmv, operatingExpenses: result.current.operatingExpenses, netProfit: result.current.netProfit })
    expect(o.cards.cmv.pct).toBe(expenses.cmv.pctOfRevenue)
    expect(o.cards.primeCost.pct).toBe(expenses.primeCost.pctOfRevenue)
    expect(o.cards.cashToday.amount).toBe(cash.cashToday)
    expect(o.cards.projection.balance).toBe(cash.projectedBalance)
    expect(o.revenueVsExpense.map((p: any) => p.revenue)).toEqual(result.history.map((h: any) => h.grossRevenue))
    expect(o.health.pillars.map((p: any) => p.key)).toEqual(['netMargin', 'runway', 'primeCost', 'revenueTrend'])
    expect(o.insights.some((i: any) => i.kind === 'breakEvenReached')).toBe(true)
  })

  it('restaurante sem lançamentos: 200, noData', async () => {
    const { auth } = await signup(freshEnv())
    const o = await getJson(auth, '/dashboard/overview')
    expect(o.health).toMatchObject({ score: null, label: 'noData' })
    expect(o.referenceMonth).toBe(toLocalMonth(new Date()))
    expect(JSON.stringify(o)).not.toMatch(/NaN|Infinity/)
  })

  it('mês atual com receita: ponto projetado em Receita × Despesa', async () => {
    const { auth, restaurantId } = await signup(freshEnv())
    const now = new Date()
    await mongoConnection.getDatabase(auth.env).collection('financial_movements').insertOne({
      restaurantId,
      title: 'Venda',
      direction: 'in',
      status: 'settled',
      statusSource: 'auto',
      date: now,
      grossValue: toDecimal128(1_000),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(1_000),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: 'c', name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: now, updatedAt: now },
    })
    const o = await getJson(auth, '/dashboard/overview')
    expect(o.revenueVsExpense.at(-1)).toMatchObject({ month: toLocalMonth(now), projected: true })
  })

  it('dois restaurantes no mesmo ambiente não se misturam', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(env, a.restaurantId)
    const ob = await getJson(b.auth, `/dashboard/overview?month=${M}`)
    expect(ob.cards.revenue.amount).toBe(0)
  })

  it.each(['?month=2026-13', 'FUTURE'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    const query = q === 'FUTURE' ? `?month=${addMonths(M, 2)}` : q
    expect((await app.inject({ method: 'GET', url: `/dashboard/overview${query}`, headers: auth })).statusCode).toBe(400)
  })

  it('sem token → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/dashboard/overview', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })
})
