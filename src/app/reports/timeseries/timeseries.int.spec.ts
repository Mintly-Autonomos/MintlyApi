import { ObjectId } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { toDecimal128 } from '../../../core/money/money'
import { addDaysToDay, startOfLocalDay, toLocalDay } from '../shared/period'

let envCounter = 0
const freshEnv = () => `int_timeseries_${++envCounter}`

describe('GET /reports/timeseries (Integration, P.3)', () => {
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

  async function signup (env: string, tag = 'a') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `ts_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string, env }
  }

  const get = (auth: Record<string, string>, query: string) => app.inject({ method: 'GET', url: `/reports/timeseries${query}`, headers: auth })

  /** Lançamento liquidado no dia (meio-dia em SP). */
  async function plant (a: { env: string, restaurantId: string }) {
    const db = mongoConnection.getDatabase(a.env)
    const cmvId = new ObjectId()
    await db.collection('financial_categories').insertOne({
      _id: cmvId, restaurantId: a.restaurantId, name: 'Insumos', type: 'expense', behavior: 'variable', dreGroup: 'cmv', operationalNature: 'operational', status: 'active', isSystem: false, usage: 0, history: [], subcategories: [], audit: { createdAt: new Date(), updatedAt: new Date() },
    } as any)
    const today = toLocalDay(new Date())
    const at = (day: string) => new Date(startOfLocalDay(day).getTime() + 12 * 3_600_000)
    const doc = (day: string, direction: 'in' | 'out', gross: number, categoryId: ObjectId | string) => ({
      restaurantId: a.restaurantId,
      title: 'Teste',
      direction,
      status: 'settled',
      statusSource: 'auto',
      date: at(day),
      grossValue: toDecimal128(gross),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(gross),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: categoryId, name: direction === 'in' ? 'Vendas' : 'Insumos', type: direction === 'in' ? 'revenue' : 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })
    await db.collection('financial_movements').insertMany([
      doc(today, 'in', 500, 'ven'),
      doc(addDaysToDay(today, -1), 'in', 300, 'ven'),
      doc(addDaysToDay(today, -1), 'out', 120, cmvId),
    ])
    return today
  }

  it('por dia: receita, CMV e lucro de cada dia; entradas e saídas pelo caixa', async () => {
    const a = await signup(freshEnv())
    const today = await plant(a)
    const res = await get(a.auth, '?granularity=day&points=3')
    expect(res.statusCode).toBe(200)
    const r = res.json().payload
    expect(r.granularity).toBe('day')
    expect(r.points).toHaveLength(3)
    const ontem = r.points.find((p: any) => p.key === addDaysToDay(today, -1))
    expect(ontem).toMatchObject({ revenue: 300, cmv: 120, profit: 180, cashIn: 300, cashOut: 120 })
    expect(r.points.at(-1)).toMatchObject({ key: today, revenue: 500, cashIn: 500 })
    expect(r.previousYear).toBeNull()
  })

  it('por mês com o ano anterior', async () => {
    const a = await signup(freshEnv())
    await plant(a)
    const r = (await get(a.auth, '?granularity=month&points=12&compare=previousYear')).json().payload
    expect(r.points).toHaveLength(12)
    expect(r.previousYear).toHaveLength(12)
    expect(r.points.at(-1).revenue).toBeGreaterThanOrEqual(500)
  })

  it.each(['?granularity=year', '?granularity=day&points=91', '?granularity=week&compare=previousYear'])('%s → 400', async (q) => {
    const a = await signup(freshEnv())
    expect((await get(a.auth, q)).statusCode).toBe(400)
  })

  it('o outro restaurante não vê os números', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(a)
    const r = (await get(b.auth, '?granularity=day&points=3')).json().payload
    expect(r.points.every((p: any) => p.revenue === 0 && p.cashIn === 0)).toBe(true)
  })

  it('sem token → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/reports/timeseries', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })
})
