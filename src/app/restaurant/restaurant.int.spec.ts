import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
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

  it('PATCH troca o regime para o Anexo II: GET usa a tabela da indústria (alíquota maior na mesma faixa)', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertMany(taxScenarioMovements(month, scenarioRefs(restaurantId)))

    await patchMe(auth, { taxRegime: 'simplesNacionalAnexoI' })
    const anexoI = (await getMe(auth)).json().payload.tax

    const patched = await patchMe(auth, { taxRegime: 'simplesNacionalAnexoII' })
    expect(patched.statusCode).toBe(200)
    const anexoII = (await getMe(auth)).json().payload.tax
    expect(anexoII).toMatchObject({ regime: 'simplesNacionalAnexoII', rbt12: anexoI.rbt12, bracket: { index: 3 } })
    expect(anexoII.effectiveRate).toBeGreaterThan(anexoI.effectiveRate)
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
    [{ name: null }],
    [{ name: '' }],
    [{ name: '   ' }],
    [{ taxRegime: null }],
    [{ team: null }],
    [{ team: [{ name: '   ', weeklyHours: 40 }] }],
    [{ team: [{ name: 'Ana', weeklyHours: 0 }] }],
    [{ team: [{ name: 'Ana', weeklyHours: 113 }] }],
    [{ team: [{ name: 'Ana' }] }],
    [{ team: [{ name: 'Ana', weeklyHours: 40, salario: 2000 }] }],
  ])('PATCH inválido %j → 400', async (payload) => {
    const { auth } = await signup(freshEnv())
    expect((await patchMe(auth, payload)).statusCode).toBe(400)
  })

  describe('início da atividade e faturamento antes do Mintly (reteste 22/11, T2)', () => {
    it('PATCH grava o mês de abertura e o faturamento (ordenado); o perfil usa no RBT12', async () => {
      const { auth } = await signup(freshEnv())
      await patchMe(auth, { taxRegime: 'simplesNacionalAnexoI' })
      const m1 = addMonths(month, -2)
      const m2 = addMonths(month, -1)
      const res = await patchMe(auth, { activityStart: addMonths(month, -3), revenueBeforeMintly: [{ month: m2, amount: 24_000.456 }, { month: m1, amount: 20_000 }] })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.revenueBeforeMintly).toEqual([{ month: m1, amount: 20_000 }, { month: m2, amount: 24_000.46 }])
      const tax = (await getMe(auth)).json().payload.tax
      // Sem venda no Mintly: M−3 sem valor (fica fora), M−2 e M−1 informados → média × 12.
      expect(tax).toMatchObject({ activityStartMonth: addMonths(month, -3), rbt12: 264_002.76, rbt12Proportional: true })
    })

    it('"" apaga o mês de abertura e [] apaga o faturamento', async () => {
      const { auth } = await signup(freshEnv())
      await patchMe(auth, { activityStart: addMonths(month, -3), revenueBeforeMintly: [{ month: addMonths(month, -1), amount: 1000 }] })
      const res = await patchMe(auth, { activityStart: '', revenueBeforeMintly: [] })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toMatchObject({ activityStart: '', revenueBeforeMintly: [] })
    })

    it.each([
      [{ activityStart: '2026-13' }],
      [{ activityStart: addMonths(toLocalMonth(new Date()), 1) }],
      [{ revenueBeforeMintly: [{ month: addMonths(toLocalMonth(new Date()), 1), amount: 10 }] }],
      [{ revenueBeforeMintly: [{ month: '2025-01', amount: 10 }, { month: '2025-01', amount: 20 }] }],
      [{ revenueBeforeMintly: [{ month: '2025-01', amount: -1 }] }],
    ])('PATCH inválido %j → 400', async (payload) => {
      const { auth } = await signup(freshEnv())
      expect((await patchMe(auth, payload)).statusCode).toBe(400)
    })
  })

  describe('equipe e carga semanal (P.4)', () => {
    it('nasce sem equipe; PATCH grava a lista (nome sem espaços, horas com 1 casa) e o GET devolve', async () => {
      const { auth } = await signup(freshEnv())
      expect((await getMe(auth)).json().payload.restaurant.team).toBeUndefined()
      const res = await patchMe(auth, { team: [{ name: '  Dona Bel ', weeklyHours: 60 }, { name: 'Joana', weeklyHours: 22.45 }] })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.team).toEqual([{ name: 'Dona Bel', weeklyHours: 60 }, { name: 'Joana', weeklyHours: 22.5 }])
      expect((await getMe(auth)).json().payload.restaurant.team).toEqual([{ name: 'Dona Bel', weeklyHours: 60 }, { name: 'Joana', weeklyHours: 22.5 }])
    })

    it('a lista é trocada inteira; [] limpa; mexer só no nome não apaga a equipe', async () => {
      const { auth } = await signup(freshEnv())
      await patchMe(auth, { team: [{ name: 'Ana', weeklyHours: 44 }, { name: 'Bia', weeklyHours: 44 }] })
      await patchMe(auth, { name: 'Cantina Renomeada' })
      expect((await getMe(auth)).json().payload.restaurant.team).toHaveLength(2)
      await patchMe(auth, { team: [{ name: 'Bia', weeklyHours: 30 }] })
      expect((await getMe(auth)).json().payload.restaurant.team).toEqual([{ name: 'Bia', weeklyHours: 30 }])
      await patchMe(auth, { team: [] })
      expect((await getMe(auth)).json().payload.restaurant.team).toEqual([])
    })

    it('a equipe de um restaurante não aparece no outro', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      await patchMe(a.auth, { team: [{ name: 'Ana', weeklyHours: 44 }] })
      expect((await getMe(b.auth)).json().payload.restaurant.team).toBeUndefined()
    })
  })

  it.each(['?month=2026-13', '?month=2026-1', 'FUTURE'])('GET %s → 400', async (query) => {
    const { auth } = await signup(freshEnv())
    const q = query === 'FUTURE' ? `?month=${addMonths(month, 1)}` : query
    expect((await getMe(auth, q)).statusCode).toBe(400)
  })

  describe('primeiro acesso (onboarding guardado no servidor)', () => {
    const completeFirstAccess = (auth: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/restaurants/me/first-access', headers: auth })

    it('quem acabou de se cadastrar nasce com o primeiro acesso VAZIO (onboarding pendente)', async () => {
      const { auth } = await signup(freshEnv())
      const restaurant = (await getMe(auth)).json().payload.restaurant
      expect(restaurant.firstAccessAt).toBeNull()
    })

    it('concluir grava a data do servidor; continua preenchida nas leituras seguintes', async () => {
      const { auth } = await signup(freshEnv())
      const antes = Date.now()
      const done = await completeFirstAccess(auth)
      expect(done.statusCode).toBe(200)
      const at = new Date(done.json().payload.firstAccessAt).getTime()
      expect(at).toBeGreaterThanOrEqual(antes - 1000)
      expect(at).toBeLessThanOrEqual(Date.now() + 1000)
      expect(new Date((await getMe(auth)).json().payload.restaurant.firstAccessAt).getTime()).toBe(at)
    })

    it('repetir não muda a data (idempotente) e o cliente não escolhe a data', async () => {
      const { auth } = await signup(freshEnv())
      const first = (await completeFirstAccess(auth)).json().payload.firstAccessAt
      const again = (await app.inject({ method: 'POST', url: '/restaurants/me/first-access', headers: auth, payload: { firstAccessAt: '2020-01-01' } })).json().payload.firstAccessAt
      expect(again).toBe(first)
    })

    it('o PATCH não preenche o primeiro acesso (só o servidor, ao concluir)', async () => {
      const { auth } = await signup(freshEnv())
      const res = await patchMe(auth, { firstAccessAt: '2026-11-02T00:00:00.000Z' })
      expect(res.statusCode).toBe(400)
      expect((await getMe(auth)).json().payload.restaurant.firstAccessAt).toBeNull()
    })

    it('restaurante anterior ao campo (ausente) não tem nada pendente e concluir não o altera', async () => {
      const env = freshEnv()
      const { auth, restaurantId } = await signup(env)
      await mongoConnection.getDatabase(env).collection('restaurants')
        .updateOne({ _id: new ObjectId(restaurantId) }, { $unset: { firstAccessAt: '' } })
      const antes = (await getMe(auth)).json().payload.restaurant
      expect(antes.firstAccessAt).toBeUndefined()
      const depois = (await completeFirstAccess(auth)).json().payload
      expect(depois.firstAccessAt).toBeUndefined()
    })

    it('concluir o de um restaurante não mexe no do outro', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      await completeFirstAccess(a.auth)
      expect((await getMe(b.auth)).json().payload.restaurant.firstAccessAt).toBeNull()
    })

    it('sem token → 401', async () => {
      const res = await app.inject({ method: 'POST', url: '/restaurants/me/first-access', headers: { env: freshEnv() } })
      expect(res.statusCode).toBe(401)
    })
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
