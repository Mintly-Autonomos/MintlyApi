import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { toDecimal128 } from '../../../core/money/money'
import { addMonths, startOfLocalMonth, toLocalDay, toLocalMonth } from '../shared/period'
import { expensesScenario } from './expenses-scenario'

let envCounter = 0
const freshEnv = () => `int_expenses_${++envCounter}`

describe('GET /reports/expenses (Integration)', () => {
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
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `exp_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  async function plant (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const { categories, movements } = expensesScenario(M, restaurantId)
    await db.collection('financial_categories').insertMany(categories)
    await db.collection('financial_movements').insertMany(movements)
  }

  const get = (auth: Record<string, string>, query = `?month=${M}`) => app.inject({ method: 'GET', url: `/reports/expenses${query}`, headers: auth })

  it('confere o cenário (Geral)', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const res = await get(auth)

    expect(res.statusCode).toBe(200)
    const r = res.json().payload
    expect(r).toMatchObject({ referenceMonth: M, channel: null, revenue: { current: 45_000, previous: 33_000 }, total: { current: 32_300, previous: 26_140, average3: 23_996.67 } })
    expect(r).toMatchObject({ cmv: { amount: 14_000 }, primeCost: { amount: 20_000 }, platformFee: { amount: 2_900, previous: 1_840, deliveryRevenue: 15_000 }, byBehavior: { fixed: 12_200, variable: 18_600, mixed: 1_500 } })
    expect(r.items.map((i: any) => [i.name, i.amount])).toEqual([
      ['Exp · CMV', 14_000], ['Exp · Pró-labore', 6_000], ['Exp · Aluguel', 4_000], ['Taxa iFood', 2_300], ['Exp · Impostos', 2_200],
      ['Exp · Utilidades', 1_500], ['Exp · Motoboy', 900], ['Exp · Marketing', 800], ['Taxa Rappi', 600], ['Exp · Antiga', 0],
    ])
    expect(r.history.map((h: any) => h.total)).toEqual([0, 0, 23_350, 22_500, 26_140, 32_300])
  })

  it('filtro Delivery e Salão', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const delivery = (await get(auth, `?month=${M}&channel=delivery`)).json().payload
    const dineIn = (await get(auth, `?month=${M}&channel=dineIn`)).json().payload

    expect(delivery).toMatchObject({ channel: 'delivery', sharedExcluded: 25_700, total: { current: 6_600 }, revenue: { current: 15_000 } })
    expect(dineIn).toMatchObject({ channel: 'dineIn', sharedExcluded: 25_700, items: [], total: { current: 0 } })
  })

  it('reclassificar a categoria muda o comportamento no mês passado', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    await mongoConnection.getDatabase(env).collection('financial_categories').updateOne({ restaurantId, name: 'Exp · Marketing' }, { $set: { behavior: 'fixed' } })

    const r = (await get(auth)).json().payload

    expect(r.byBehavior).toEqual({ fixed: 13_000, variable: 17_800, mixed: 1_500 })
  })

  it('despesa às 22h do último dia conta no próprio mês', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertOne({
      restaurantId,
      title: 'Noite',
      direction: 'out',
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(addMonths(M, 1)).getTime() - 2 * 3_600_000),
      grossValue: toDecimal128(250),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(250),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: 'c', name: 'Gás', type: 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const r = (await get(auth)).json().payload

    expect(r.total.current).toBe(250)
    expect(r.items[0]).toMatchObject({ name: 'Gás', amount: 250, average3: null })
  })

  it('restaurante sem lançamentos: 200 com zeros', async () => {
    const { auth } = await signup(freshEnv())
    const r = (await get(auth)).json().payload
    expect(r).toMatchObject({ items: [], total: { current: 0, average3: null }, cmv: { pctOfRevenue: null } })
  })

  it('dois restaurantes no mesmo ambiente não se misturam', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(env, a.restaurantId)

    const rb = (await get(b.auth)).json().payload

    expect(rb.total.current).toBe(0)
    expect(rb.items).toEqual([])
  })

  it.each(['?month=2026-13', 'FUTURE', '?channel=shared', '?channel=salao'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    const query = q === 'FUTURE' ? `?month=${addMonths(M, 2)}` : q
    expect((await get(auth, query)).statusCode).toBe(400)
  })

  it('sem month: mês corrente; sem token → 401', async () => {
    const { auth } = await signup(freshEnv())
    expect((await get(auth, '')).json().payload.referenceMonth).toBe(toLocalMonth(new Date()))
    expect((await app.inject({ method: 'GET', url: '/reports/expenses', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })

  it('fatia 7: subitens do CMV e anomalias por HTTP', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const r = (await get(auth)).json().payload
    const cmv = r.items.find((i: any) => i.name === 'Exp · CMV')

    expect(cmv.subitems.map((s: any) => [s.name, s.amount])).toEqual([['Frango', 6_000], ['Embalagens', 4_400], ['Óleo', 1_500], ['Sem subitem', 2_100]])
    expect(r.anomalies.map((a: any) => [a.name, a.excess])).toEqual([['Embalagens', 2_900], ['Exp · Marketing', 300]])
    expect(r.items.filter((i: any) => i.hasAnomaly).map((i: any) => i.name)).toEqual(['Exp · CMV', 'Exp · Marketing'])
    expect(r.projection).toBeNull()
  })

  it('subcategoria renomeada mostra o nome atual; lançamento sem o campo vai para "Sem subitem"', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    const db = mongoConnection.getDatabase(env)
    await db.collection('financial_categories').updateOne({ restaurantId, name: 'Exp · CMV' }, { $set: { 'subcategories.$[s].name': 'Frango inteiro' } }, { arrayFilters: [{ 's._id': 'sub-fra' }] })
    await db.collection('financial_movements').updateMany({ restaurantId, 'subcategory._id': 'sub-ole' }, { $unset: { subcategory: '' } })

    const cmv = (await get(auth)).json().payload.items.find((i: any) => i.name === 'Exp · CMV')

    expect(cmv.subitems.map((s: any) => [s.name, s.amount])).toEqual([['Frango inteiro', 6_000], ['Embalagens', 4_400], ['Sem subitem', 3_600]])
  })

  it('mês atual: lançamento com data futura no mês entra na projeção sem ser multiplicado', async () => {
    const now = new Date()
    const day = toLocalDay(now)
    const elapsed = Number(day.slice(8, 10))
    const days = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate()
    if (elapsed === days) return // último dia do mês: não há "depois de hoje" no mês

    const { auth, restaurantId } = await signup(freshEnv())
    const doc = (title: string, date: Date, gross: number) => ({
      restaurantId,
      title,
      direction: 'out',
      status: 'pending',
      statusSource: 'auto',
      date,
      grossValue: toDecimal128(gross),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(gross),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: 'c', name: 'Aluguel', type: 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: now, updatedAt: now },
    })
    const lastDayNoon = new Date(startOfLocalMonth(addMonths(toLocalMonth(now), 1)).getTime() - 12 * 3_600_000)
    await mongoConnection.getDatabase(auth.env).collection('financial_movements').insertMany([doc('Hoje', now, 310), doc('Aluguel do fim do mês', lastDayNoon, 2_000)])

    const r = (await get(auth, '')).json().payload

    expect(r.total.current).toBe(2_310)
    expect(r.projection.total).toBe(Math.round(31_000 * days / elapsed) / 100 + 2_000)
  })

  it('mês atual: projeção pelo dia de hoje em SP', async () => {
    const { auth, restaurantId } = await signup(freshEnv())
    const now = new Date()
    await mongoConnection.getDatabase(auth.env).collection('financial_movements').insertOne({
      restaurantId,
      title: 'Hoje',
      direction: 'out',
      status: 'settled',
      statusSource: 'auto',
      date: now,
      grossValue: toDecimal128(310),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(310),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: 'c', name: 'Gás', type: 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: now, updatedAt: now },
    })

    const r = (await get(auth, '')).json().payload
    const day = toLocalDay(now)
    const elapsed = Number(day.slice(8, 10))
    const days = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate()

    expect(r.projection).toEqual({ total: Math.round(31_000 * days / elapsed) / 100, revenue: 0, elapsedDays: elapsed, daysInMonth: days })
    expect(r.items[0].projected).toBe(r.projection.total)
  })
})
