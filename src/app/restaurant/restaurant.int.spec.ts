import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { toLocalMonth, addMonths } from '../reports/shared/period'
import { TAX_SCENARIO_EXPECTED, taxScenarioMovements } from '../tax/tax-scenario'

let envCounter = 0
const freshEnv = () => `int_rest_${++envCounter}`
const scenarioRefs = (restaurantId: string) => ({ restaurantId, account: { _id: 'acc', name: 'Caixa', type: 'cash' }, revenueCategory: { _id: 'cat', name: 'Vendas' } })

describe('/restaurants/me (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance
  const month = toLocalMonth(new Date())

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
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `rest_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  const getMe = (auth: Record<string, string>, query = '') => app.inject({ method: 'GET', url: `/restaurants/me${query}`, headers: auth })
  const patchMe = (auth: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/restaurants/me', headers: auth, payload })

  it('sem regime: restaurante + perfil com taxRegimeNotConfigured', async () => {
    const { auth } = await signup(freshEnv())
    const res = await getMe(auth)
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.restaurant).toMatchObject({ name: 'Cantina a' })
    expect(res.json().payload.tax).toMatchObject({ regime: null, referenceMonth: month, rbt12: 0, insights: [{ kind: 'taxRegimeNotConfigured' }] })
  })

  it('PATCH grava o regime; GET mostra o perfil do Simples do cenário', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertMany(taxScenarioMovements(month, scenarioRefs(restaurantId)))

    const patched = await patchMe(auth, { taxRegime: 'simplesNacionalAnexoI' })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().payload).toMatchObject({ taxRegime: 'simplesNacionalAnexoI' })

    const tax = (await getMe(auth)).json().payload.tax
    expect(tax).toMatchObject({ regime: 'simplesNacionalAnexoI', rbt12: TAX_SCENARIO_EXPECTED.rbt12, bracket: { index: 3 }, previousBracketIndex: 2 })
    expect(tax.insights[0]).toMatchObject({ kind: 'bracketChanged', fromBracket: 2, toBracket: 3 })

    const lastMonth = (await getMe(auth, `?month=${addMonths(month, -1)}`)).json().payload.tax
    expect(lastMonth).toMatchObject({ referenceMonth: addMonths(month, -1), rbt12: 348_000, bracket: { index: 2 } })
  })

  it('PATCH troca o nome e atualiza o audit', async () => {
    const { auth } = await signup(freshEnv())
    const res = await patchMe(auth, { name: 'Cantina Nova' })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.name).toBe('Cantina Nova')
    expect(res.json().payload.audit.updatedBy).toBeDefined()
  })

  it.each([
    [{ taxRegime: 'lucroReal' }],
    [{ audit: { createdAt: new Date() } }],
    [{ restaurantId: 'outro' }],
  ])('PATCH inválido %j → 400', async (payload) => {
    const { auth } = await signup(freshEnv())
    expect((await patchMe(auth, payload)).statusCode).toBe(400)
  })

  it.each(['?month=2026-13', '?month=2026-1', 'FUTURE'])('GET %s → 400', async (query) => {
    const { auth } = await signup(freshEnv())
    const q = query === 'FUTURE' ? `?month=${addMonths(month, 1)}` : query
    expect((await getMe(auth, q)).statusCode).toBe(400)
  })

  it('sem token → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/restaurants/me', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })

  it('dois restaurantes no mesmo ambiente: cada um vê só o seu', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await mongoConnection.getDatabase(env).collection('financial_movements').insertMany(taxScenarioMovements(month, scenarioRefs(a.restaurantId)))
    await patchMe(b.auth, { taxRegime: 'mei' })

    const meA = (await getMe(a.auth)).json().payload
    const meB = (await getMe(b.auth)).json().payload

    expect(meA.restaurant.name).toBe('Cantina a')
    expect(meA.tax.rbt12).toBe(364_000)
    expect(meB.restaurant).toMatchObject({ name: 'Cantina b', taxRegime: 'mei' })
    expect(meB.tax).toMatchObject({ regime: 'mei', rbt12: 0, meiCap: { yearToDateRevenue: 0 } })
  })
})
