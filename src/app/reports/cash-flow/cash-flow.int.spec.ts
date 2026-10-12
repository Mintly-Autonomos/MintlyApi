import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { toDecimal128 } from '../../../core/money/money'
import { addDaysToDay, toLocalDay, startOfLocalDay } from '../shared/period'
import { cashFlowScenarioAccounts, cashFlowScenarioExpected, cashFlowScenarioMovements } from './cash-flow-scenario'

let envCounter = 0
const freshEnv = () => `int_cash_flow_${++envCounter}`

describe('GET /reports/cash-flow (Integration)', () => {
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

  async function signup (env: string, tag: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: {
        person: { name: `Dono ${tag}`, phone: '11977777777' },
        password: 'Senha123',
        restaurantName: `Restaurante ${tag}`,
        termsAccepted: true,
        email: `dono_${tag}_${env}@teste.com`,
      },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  async function plantScenario (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const accounts = await db.collection('financial_accounts').insertMany(cashFlowScenarioAccounts(restaurantId))
    const accountId = String(accounts.insertedIds[0])
    const today = toLocalDay(new Date())
    await db.collection('financial_movements').insertMany(cashFlowScenarioMovements(today, {
      restaurantId,
      account: { _id: accountId, name: 'Demo · Caixa', type: 'cash' },
      revenueCategory: { _id: 'cat-rev', name: 'Vendas' },
      expenseCategory: { _id: 'cat-exp', name: 'Despesas' },
    }))
    return today
  }

  const get = (auth: Record<string, string>, query = '') =>
    app.inject({ method: 'GET', url: `/reports/cash-flow${query}`, headers: auth })

  it('confere o cenário no horizonte de 30 dias', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env, 'a')
    const today = await plantScenario(env, restaurantId)
    const expected = cashFlowScenarioExpected(today, 30)

    const res = await get(auth, '?horizon=30')

    expect(res.statusCode).toBe(200)
    const report = res.json().payload
    expect(report).toMatchObject({
      horizon: 30,
      today,
      cashToday: expected.cashToday,
      receivable: expected.receivable,
      payable: expected.payable,
      projectedBalance: expected.projectedBalance,
      lowestBalance: expected.lowestBalance,
      overdue: expected.overdue,
      safetyThreshold: expected.safetyThreshold,
      insights: expected.insights,
    })
    expect(report.projection).toHaveLength(expected.projectionLength)
    expect(report.realized.map((p: any) => p.balance)).toEqual(expected.realizedBalances)
    expect(report.weeks[0]).toEqual(expected.week1)
    expect(report.dueItems.map((i: any) => i.title)).toEqual(expected.dueItemTitles)
    expect(report.dueItems.find((i: any) => i.title === 'Energia elétrica')).toMatchObject({
      status: 'settled', dueDate: addDaysToDay(today, -3), settledAt: addDaysToDay(today, -2),
    })
    expect(report.dueItems.filter((i: any) => i.overdue).map((i: any) => i.title)).toEqual(['Fornecedor Embalagens', 'Taxas de cartão'])
  })

  it('trocar o horizonte recalcula os blocos', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env, 'b')
    const today = await plantScenario(env, restaurantId)
    const expected = cashFlowScenarioExpected(today, 60)

    const report = (await get(auth, '?horizon=60')).json().payload

    expect(report).toMatchObject({ horizon: 60, payable: expected.payable, projectedBalance: expected.projectedBalance })
    expect(report.projection).toHaveLength(expected.projectionLength)
    expect(report.dueItems.map((i: any) => i.title)).toEqual(expected.dueItemTitles)
  })

  it('sem query usa o horizonte padrão de 30', async () => {
    const env = freshEnv()
    const { auth } = await signup(env, 'c')

    const report = (await get(auth)).json().payload

    expect(report.horizon).toBe(30)
    expect(report.projection).toHaveLength(31)
  })

  it('restaurante recém-criado, sem movimentação: 200 com tudo zerado', async () => {
    const env = freshEnv()
    const { auth } = await signup(env, 'd')

    const res = await get(auth)

    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toMatchObject({ cashToday: 0, receivable: 0, payable: 0, dueItems: [], insights: [] })
  })

  it('dois restaurantes no mesmo ambiente não enxergam os números um do outro', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    const today = await plantScenario(env, a.restaurantId)
    const db = mongoConnection.getDatabase(env)
    await db.collection('financial_accounts').insertOne({ restaurantId: b.restaurantId, name: 'Rica', type: 'cash', status: 'active', isDefault: false, availableBalance: toDecimal128(1000000), predictedBalance: toDecimal128(0), audit: { createdAt: new Date(), updatedAt: new Date() } })
    await db.collection('financial_movements').insertOne({
      restaurantId: b.restaurantId,
      title: 'Do outro restaurante',
      direction: 'out',
      status: 'pending',
      statusSource: 'auto',
      date: new Date(),
      dueDate: startOfLocalDay(addDaysToDay(today, 1)),
      grossValue: toDecimal128(99999),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(99999),
      account: { _id: 'x', name: 'Rica', type: 'cash' },
      category: { _id: 'y', name: 'Z', type: 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const reportA = (await get(a.auth)).json().payload
    const reportB = (await get(b.auth)).json().payload

    expect(reportA).toMatchObject({ cashToday: 9000, payable: 8950 })
    expect(reportA.dueItems.map((i: any) => i.title)).not.toContain('Do outro restaurante')
    expect(reportB).toMatchObject({ cashToday: 1000000, payable: 99999, receivable: 0 })
  })

  it.each(['0', '366', 'abc', '1.5'])('horizon=%s → 400', async (horizon) => {
    const env = freshEnv()
    const { auth } = await signup(env, `h${horizon.replace('.', '')}`)

    const res = await get(auth, `?horizon=${horizon}`)

    expect(res.statusCode).toBe(400)
  })

  it('sem token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/cash-flow', headers: { env: freshEnv() } })
    expect(res.statusCode).toBe(401)
  })
})
