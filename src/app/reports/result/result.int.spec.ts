import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { toDecimal128 } from '../../../core/money/money'
import { addMonths, startOfLocalMonth, toLocalDay, toLocalMonth } from '../shared/period'
import { resultScenario, resultScenarioExpected } from './result-scenario'

let envCounter = 0
const freshEnv = () => `int_result_${++envCounter}`

describe('GET /reports/result (Integration)', () => {
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
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `res_${tag}_${env}@teste.com` },
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

  const get = (auth: Record<string, string>, query = `?month=${M}`) => app.inject({ method: 'GET', url: `/reports/result${query}`, headers: auth })

  it('confere o cenário linha a linha', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    const expected = resultScenarioExpected(M)

    const res = await get(auth)

    expect(res.statusCode).toBe(200)
    const r = res.json().payload
    expect(r).toMatchObject({ referenceMonth: M, previousMonth: expected.previousMonth, current: expected.current, previous: expected.previous })
    expect(r.tax.effectiveRate).toBeCloseTo(expected.effectiveRate, 10)
    expect(r.operatingExpenseItems.map((i: any) => i.name)).toEqual(expected.itemNames)
    expect(r.breakEven).toMatchObject(expected.breakEven)
    expect(r.history).toHaveLength(6)
    expect(r.history[5]).toMatchObject({ month: M, netProfit: 6_372 })
    expect(r.insights.map((i: any) => i.kind)).toEqual(expected.insightKinds)
  })

  it('reclassificar a categoria muda o DRE do mês passado', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    await mongoConnection.getDatabase(env).collection('financial_categories').updateOne({ restaurantId, name: 'Demo · Marketing' }, { $set: { dreGroup: 'cmv' } })

    const r = (await get(auth)).json().payload

    expect(r.current).toMatchObject({ cmv: 22_224, operatingExpenses: 26_300 })
    expect(r.previous).toMatchObject({ cmv: 14_900, operatingExpenses: 14_000 })
  })

  it('receita às 22h do último dia conta no próprio mês', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertOne({
      restaurantId,
      title: 'Noite',
      direction: 'in',
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(addMonths(M, 1)).getTime() - 2 * 3_600_000),
      grossValue: toDecimal128(1_000),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(1_000),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: 'c', name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const r = (await get(auth)).json().payload

    expect(r.current.grossRevenue).toBe(1_000)
    expect(r.insights).toContainEqual({ kind: 'taxRegimeNotConfigured', severity: 'info' })
  })

  it('dois restaurantes no mesmo ambiente não se misturam', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(env, a.restaurantId)

    const rb = (await get(b.auth)).json().payload

    expect(rb.current).toMatchObject({ grossRevenue: 0, netProfit: 0 })
    expect(rb.operatingExpenseItems).toEqual([])
  })

  it.each(['?month=2026-13', '?month=2026-1', 'FUTURE'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    const query = q === 'FUTURE' ? `?month=${addMonths(M, 2)}` : q
    expect((await get(auth, query)).statusCode).toBe(400)
  })

  it('sem month: mês corrente; sem token → 401', async () => {
    const { auth } = await signup(freshEnv())
    expect((await get(auth, '')).json().payload.referenceMonth).toBe(toLocalMonth(new Date()))
    expect((await app.inject({ method: 'GET', url: '/reports/result', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })

  it('ajuste A1 — mês atual compara com o mês anterior até o mesmo dia', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    const now = new Date()
    const today = toLocalDay(now)
    const todayDay = Number(today.slice(8, 10))
    const prev = addMonths(toLocalMonth(now), -1)
    const lastPrevDay = Number(new Date(Date.UTC(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), 0)).toISOString().slice(8, 10))
    const doc = (date: Date, gross: number) => ({
      restaurantId,
      title: 'Venda',
      direction: 'in',
      status: 'settled',
      statusSource: 'auto',
      date,
      grossValue: toDecimal128(gross),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(gross),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: 'c', name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: now, updatedAt: now },
    })
    const dayOf = (month: string, day: number) => new Date(startOfLocalMonth(month).getTime() + (day - 1) * 86_400_000 + 12 * 3_600_000)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertMany([doc(dayOf(prev, 1), 1_000), doc(dayOf(prev, lastPrevDay), 5_000)])

    const r = (await get(auth, '')).json().payload

    expect(r.comparison).toEqual({ kind: 'samePeriod', untilDay: todayDay })
    expect(r.previous.grossRevenue).toBe(lastPrevDay <= todayDay ? 6_000 : 1_000)
    expect(r.history.at(-2).grossRevenue).toBe(6_000)
    expect((await get(auth, `?month=${prev}`)).json().payload.comparison).toEqual({ kind: 'fullMonth', untilDay: null })
  })
})
