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

  it('empréstimo e equipamento (Não operacional) ficam fora da receita, dos custos e do RBT12, e aparecem em linha própria', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    const db = mongoConnection.getDatabase(env)
    const now = new Date()
    const category = async (name: string, type: 'revenue' | 'expense', operationalNature: string) => String((await db.collection('financial_categories').insertOne({
      restaurantId, name, type, behavior: 'fixed', dreGroup: type === 'expense' ? 'opex' : undefined, operationalNature, status: 'active', isSystem: false, audit: { createdAt: now, updatedAt: now },
    })).insertedId)
    const vendas = await category('Vendas', 'revenue', 'operational')
    const emprestimo = await category('Empréstimos recebidos', 'revenue', 'nonOperational')
    const aluguel = await category('Aluguel do ponto', 'expense', 'operational')
    const equipamento = await category('Equipamentos', 'expense', 'nonOperational')
    const mov = (direction: 'in' | 'out', categoryId: string, name: string, value: number) => ({
      restaurantId,
      title: name,
      direction,
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(M).getTime() + 10 * 86_400_000 + 12 * 3_600_000),
      grossValue: toDecimal128(value),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(value),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: categoryId, name, type: direction === 'in' ? 'revenue' : 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: now, updatedAt: now },
    })
    await db.collection('financial_movements').insertMany([
      mov('in', vendas, 'Vendas', 26_795),
      mov('in', emprestimo, 'Empréstimos recebidos', 15_000),
      mov('out', aluguel, 'Aluguel do ponto', 4_200),
      mov('out', equipamento, 'Equipamentos', 3_850),
    ])

    const r = (await get(auth)).json().payload
    expect(r.current).toMatchObject({
      grossRevenue: 26_795,
      operatingExpenses: 4_200,
      netProfit: 22_595,
      nonOperatingIncome: 15_000,
      nonOperatingExpenses: 3_850,
      resultAfterNonOperating: 22_595 + 15_000 - 3_850,
    })
    expect(r.operatingExpenseItems.map((i: any) => i.name)).toEqual(['Aluguel do ponto'])

    const custos = (await app.inject({ method: 'GET', url: `/reports/expenses?month=${M}`, headers: auth })).json().payload
    expect(custos.revenue.current).toBe(26_795)
    expect(custos.total.current).toBe(4_200)
  })

  it('MEI sem o DAS configurado: imposto fixo pelo DAS típico, mesmo com 2 DAS pagos no mês (reteste 22/11, T1)', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    const db = mongoConnection.getDatabase(env)
    const now = new Date()
    await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'mei' } })
    const vendas = String((await db.collection('financial_categories').insertOne({ restaurantId, name: 'Vendas', type: 'revenue', behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit: { createdAt: now, updatedAt: now } })).insertedId)
    const das = String((await db.collection('financial_categories').insertOne({ restaurantId, name: 'Impostos', type: 'expense', behavior: 'fixed', dreGroup: 'tax', operationalNature: 'operational', status: 'active', isSystem: false, audit: { createdAt: now, updatedAt: now } })).insertedId)
    const mov = (month: string, day: number, direction: 'in' | 'out', categoryId: string, value: number) => ({
      restaurantId,
      title: 'x',
      direction,
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(month).getTime() + (day - 1) * 86_400_000 + 12 * 3_600_000),
      grossValue: toDecimal128(value),
      feeValue: toDecimal128(0),
      netValue: toDecimal128(value),
      account: { _id: 'a', name: 'Caixa', type: 'cash' },
      category: { _id: categoryId, name: direction === 'in' ? 'Vendas' : 'Impostos', type: direction === 'in' ? 'revenue' : 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: now, updatedAt: now },
    })
    const P = addMonths(M, -1)
    await db.collection('financial_movements').insertMany([
      mov(P, 5, 'in', vendas, 8_000),
      mov(M, 5, 'in', vendas, 9_000),
      mov(P, 20, 'out', das, 81.05),
      // Dois DAS pagos no mesmo dia 20 (o de M−1 atrasado e o de M).
      mov(M, 20, 'out', das, 81.05),
      mov(M, 20, 'out', das, 81.05),
    ])

    const r = (await get(auth)).json().payload
    expect(r.current.taxes).toBe(81.05)
    expect(r.previous.taxes).toBe(81.05)
    expect(r.tax).toMatchObject({ regime: 'mei', meiMonthlyDas: 81.05, meiDasEstimated: true })
    expect(r.current.netProfit).toBe(9_000 - 81.05)
  })

  it('lançamento do dia 1º cadastrado pelo app (AAAA-MM-DD) conta no próprio mês, não no anterior', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    const db = mongoConnection.getDatabase(env)
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })
    const category = await db.collection('financial_categories').insertOne({
      restaurantId,
      name: 'Vendas do dia',
      type: 'revenue',
      behavior: 'variable',
      operationalNature: 'operational',
      status: 'active',
      isSystem: false,
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })
    const lancar = (date: string, grossValue: number) => app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: { direction: 'in', title: 'Fechamento', grossValue, date, paymentMethod: 'cash', accountId: String(cash!._id), categoryId: String(category.insertedId) },
    })
    const ultimoDiaAnterior = toLocalDay(new Date(startOfLocalMonth(M).getTime() - 12 * 3_600_000))

    expect((await lancar(`${M}-01`, 700)).statusCode).toBe(201) // dia 1º do mês M
    expect((await lancar(ultimoDiaAnterior, 300)).statusCode).toBe(201) // último dia do mês anterior

    const atual = (await get(auth)).json().payload
    const anterior = (await get(auth, `?month=${addMonths(M, -1)}`)).json().payload
    expect(atual.current.grossRevenue).toBe(700)
    expect(anterior.current.grossRevenue).toBe(300)

    const gravado = await db.collection('financial_movements').findOne({ restaurantId, grossValue: { $exists: true }, title: 'Fechamento', 'audit.createdAt': { $exists: true } }, { sort: { _id: 1 } })
    expect(toLocalDay(gravado!.date)).toBe(`${M}-01`)
    expect((gravado!.date as Date).toISOString()).toBe(`${M}-01T15:00:00.000Z`)
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

  it.each(['?month=2026-13', '?month=2026-1', 'FUTURE', '?historyMonths=7', '?historyMonths=abc'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    // Mais de 12 meses à frente do mês corrente (até 12 o Resultado aceita: U.4).
    const query = q === 'FUTURE' ? `?month=${addMonths(toLocalMonth(new Date()), 13)}` : q
    expect((await get(auth, query)).statusCode).toBe(400)
  })

  it('U.4 — mês futuro mostra o já lançado; historyMonths=12 devolve 12 meses', async () => {
    const env = freshEnv()
    const { auth } = await signup(env)
    const futuro = addMonths(toLocalMonth(new Date()), 2)
    const res = await get(auth, `?month=${futuro}&historyMonths=12`)
    expect(res.statusCode).toBe(200)
    const r = res.json().payload
    expect(r.referenceMonth).toBe(futuro)
    expect(r.history).toHaveLength(12)
    expect(r.history[11].month).toBe(futuro)
    expect(r.comparison).toEqual({ kind: 'fullMonth', untilDay: null })
    expect(r.previousYear).toBeNull()
  })

  it('U.4 — previousYear: o cenário do mês M visto 12 meses depois', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    const daqui = addMonths(M, 12)
    if (daqui > addMonths(toLocalMonth(new Date()), 12)) return
    const r = (await get(auth, `?month=${daqui}`)).json().payload
    expect(r.previousYear).toMatchObject({ month: M, lines: { grossRevenue: 58_400, netProfit: 6_372 } })
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
