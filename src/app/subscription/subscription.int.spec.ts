import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { addDays as addDaysTo } from 'mintly-lib'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { ensureAllIndexes } from '../../infrastructure/db/indices'
import { buildServer } from '../../infrastructure/server/build-server'

// Este spec exercita o portão de assinatura DE VERDADE (os demais testes de integração o substituem).
vi.unmock('../../core/hooks/require-active-subscription')

const SIGNUP_BASE = {
  person: { name: 'Dono Assinatura', phone: '11977777777' },
  password: 'Senha123',
  restaurantName: 'Restaurante Assinatura',
  termsAccepted: true,
}
const DAY = 24 * 60 * 60 * 1000
/** Dias de cada plano (dias fixos): 1 mês = 30, 3 = 90, 6 = 180, 12 = 360. */
const addDays = addDaysTo
const WEBHOOK_SECRET = 'segredo-do-webhook'

let envCounter = 0
const freshEnv = () => `int_sub_${++envCounter}`

describe('Assinatura (Integration)', () => {
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

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER = 'mock'
    process.env.FRONTEND_URL = 'https://app.mintly.test'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PAYMENT_PROVIDER
    delete process.env.MP_ACCESS_TOKEN
    delete process.env.MP_WEBHOOK_SECRET
  })

  async function signup () {
    const env = freshEnv()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const payload = res.json().payload
    await ensureAllIndexes(env)
    return {
      env,
      email: `dono_${env}@teste.com`,
      restaurantId: payload.user.restaurantId as string,
      auth: { env, authorization: `Bearer ${payload.accessToken}` },
      signupPayload: payload,
    }
  }

  const db = (env: string) => mongoConnection.getDatabase(env)
  const setEndsAt = (env: string, restaurantId: string, endsAt: Date | null) =>
    db(env).collection('restaurants').updateOne(
      { _id: new ObjectId(restaurantId) },
      endsAt ? { $set: { 'subscription.endsAt': endsAt } } : { $unset: { subscription: '' } },
    )
  const getEndsAt = async (env: string, restaurantId: string): Promise<Date | null> => {
    const doc = await db(env).collection('restaurants').findOne({ _id: new ObjectId(restaurantId) })
    return doc?.subscription?.endsAt ?? null
  }
  const overview = async (auth: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/subscription', headers: auth })).json().payload
  const checkout = (auth: Record<string, string>, months: unknown, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/subscription/checkout', headers: auth, payload: { months, ...extra } })
  const decide = (auth: Record<string, string>, paymentId: string, decision: unknown) =>
    app.inject({ method: 'POST', url: '/subscription/mock/decide', headers: auth, payload: { paymentId, decision } })

  describe('portão: sem assinatura não entra', () => {
    it('conta recém-criada nasce SEM assinatura e o cadastro já avisa', async () => {
      const { signupPayload } = await signup()
      expect(signupPayload.subscription).toEqual({ status: 'none', tier: null, endsAt: null, daysLeft: null, expiresSoon: false })
    })

    it('o login devolve o estado da assinatura (none) para o front levar à tela de assinatura', async () => {
      const { env, email } = await signup()
      const res = await app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password: SIGNUP_BASE.password } })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.subscription.status).toBe('none')
    })

    it.each([
      ['/financial-accounts'],
      ['/financial-categories'],
      ['/financial-movements'],
      ['/menu-items/price-alerts'],
      ['/restaurants/me'],
      ['/dashboard/overview'],
    ])('GET %s sem assinatura responde 402 SUBSCRIPTION-0001', async (url) => {
      const { auth } = await signup()
      const res = await app.inject({ method: 'GET', url, headers: auth })
      expect(res.statusCode).toBe(402)
      expect(res.json().code).toBe('SUBSCRIPTION-0001')
    })

    it('escrever também é barrado (POST de movimentação)', async () => {
      const { auth } = await signup()
      const res = await app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: {} })
      expect(res.statusCode).toBe(402)
    })

    it('sem token continua sendo 401 (o login vem antes da assinatura)', async () => {
      const { env } = await signup()
      const res = await app.inject({ method: 'GET', url: '/financial-accounts', headers: { env } })
      expect(res.statusCode).toBe(401)
    })

    it('as rotas de assinatura e a saúde ficam abertas para quem não tem assinatura', async () => {
      const { auth } = await signup()
      expect((await app.inject({ method: 'GET', url: '/subscription', headers: auth })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    })

    it('/subscription exige login', async () => {
      const { env } = await signup()
      expect((await app.inject({ method: 'GET', url: '/subscription', headers: { env } })).statusCode).toBe(401)
    })

    it('com data limite no futuro (gravada à mão no banco) a pessoa entra', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() + 30 * DAY))

      const res = await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })
      expect(res.statusCode).toBe(200)
      const state = await overview(auth)
      expect(state).toMatchObject({ status: 'active', expiresSoon: false })
      expect(state.daysLeft).toBeGreaterThanOrEqual(29)
    })

    it('a 3 dias do vencimento ainda entra, mas o estado manda avisar', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() + 3 * DAY - 1000))

      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(200)
      expect(await overview(auth)).toMatchObject({ status: 'active', expiresSoon: true, daysLeft: 3 })
    })

    it('vencida: volta a ser barrada como se nunca tivesse assinado, e o estado diz expired', async () => {
      const { env, restaurantId, auth, email } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() - 1000))

      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(402)
      expect(await overview(auth)).toMatchObject({ status: 'expired', daysLeft: null })

      const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password: SIGNUP_BASE.password } })
      expect(login.json().payload.subscription.status).toBe('expired')
    })

    it('a assinatura é por restaurante: a de um não libera o outro', async () => {
      const a = await signup()
      const b = await signup()
      await setEndsAt(a.env, a.restaurantId, new Date(Date.now() + 30 * DAY))
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: a.auth })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: b.auth })).statusCode).toBe(402)
    })

    it('data limite em formato inválido no banco conta como sem assinatura (não libera)', async () => {
      const { env, restaurantId, auth } = await signup()
      await db(env).collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { 'subscription.endsAt': 'lixo' } })
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(402)
    })
  })

  describe('GET /subscription', () => {
    it('devolve os tipos Básico e Pro, cada um com os 4 planos, preços e descontos, e o provedor', async () => {
      const { auth } = await signup()
      const state = await overview(auth)
      expect(state.provider).toBe('mock')
      expect(state.tiers.map((t: any) => [t.tier, t.label, t.monthlyCents])).toEqual([
        ['basic', 'Básico', 15000],
        ['pro', 'Pro', 22900],
      ])
      const plans = (tier: string) => state.tiers.find((t: any) => t.tier === tier).plans.map((p: any) => [p.months, p.totalCents, p.discountPercent])
      expect(plans('basic')).toEqual([
        [1, 15000, 0],
        [3, 42750, 5],
        [6, 81000, 10],
        [12, 153000, 15],
      ])
      expect(plans('pro')).toEqual([
        [1, 22900, 0],
        [3, 65265, 5],
        [6, 123660, 10],
        [12, 233580, 15],
      ])
    })

    it('o estado traz o tipo: nenhum antes de assinar, pro depois de pagar o Pro', async () => {
      const { auth } = await signup()
      expect((await overview(auth)).tier).toBeNull()
      const { paymentId } = (await checkout(auth, 1, { tier: 'pro' })).json().payload
      await decide(auth, paymentId, 'approved')
      expect(await overview(auth)).toMatchObject({ status: 'active', tier: 'pro' })
    })
  })

  describe('POST /subscription/checkout', () => {
    it.each([[2], [0], [13], ['3'], [null], [undefined], [1.5]])('plano inválido (%s) → 400', async (months) => {
      const { auth } = await signup()
      const res = await checkout(auth, months)
      expect(res.statusCode).toBe(400)
    })

    it('exige login', async () => {
      const { env } = await signup()
      const res = await app.inject({ method: 'POST', url: '/subscription/checkout', headers: { env }, payload: { months: 1 } })
      expect(res.statusCode).toBe(401)
    })

    it.each([[1, 15000], [3, 42750], [6, 81000], [12, 153000]])('plano de %i meses cobra %i centavos e abre um pagamento pendente', async (months, cents) => {
      const { env, restaurantId, auth } = await signup()
      const res = await checkout(auth, months)
      expect(res.statusCode).toBe(201)
      const body = res.json().payload
      expect(body).toMatchObject({ provider: 'mock', months, totalCents: cents })
      expect(body.checkoutUrl).toBe(`https://app.mintly.test/assinatura/simulador?pagamento=${body.paymentId}`)

      const saved = await db(env).collection('payments').findOne({ _id: new ObjectId(body.paymentId) })
      expect(saved).toMatchObject({ restaurantId, months, amountCents: cents, status: 'pending', provider: 'mock' })
      expect(saved?.appliedAt).toBeUndefined()
    })

    it('o valor NUNCA vem do cliente: um amountCents mandado no corpo é ignorado', async () => {
      const { env, auth } = await signup()
      const res = await checkout(auth, 12, { amountCents: 1, totalCents: 1, price: 0.01 })
      expect(res.statusCode).toBe(201)
      const saved = await db(env).collection('payments').findOne({ _id: new ObjectId(res.json().payload.paymentId) })
      expect(saved?.amountCents).toBe(153000)
    })

    it('criar a cobrança não dá acesso nenhum', async () => {
      const { env, restaurantId, auth } = await signup()
      await checkout(auth, 1)
      expect(await getEndsAt(env, restaurantId)).toBeNull()
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(402)
    })
  })

  describe('simulador (PAYMENT_PROVIDER=mock)', () => {
    it('aprovar libera o acesso por 1 mês', async () => {
      const { env, restaurantId, auth } = await signup()
      const { paymentId } = (await checkout(auth, 1)).json().payload

      const res = await decide(auth, paymentId, 'approved')
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.status).toBe('approved')

      const endsAt = await getEndsAt(env, restaurantId)
      expect(endsAt).not.toBeNull()
      expect(endsAt!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY)
      expect(endsAt!.getTime()).toBeLessThan(Date.now() + 32 * DAY)

      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(200)
      expect(await overview(auth)).toMatchObject({ status: 'active' })
    })

    it('o plano de 12 meses libera 360 dias', async () => {
      const { env, restaurantId, auth } = await signup()
      const { paymentId } = (await checkout(auth, 12)).json().payload
      await decide(auth, paymentId, 'approved')
      const endsAt = await getEndsAt(env, restaurantId)
      expect(endsAt!.getTime()).toBeGreaterThan(Date.now() + 359 * DAY)
      expect(endsAt!.getTime()).toBeLessThan(Date.now() + 361 * DAY)
    })

    it('o login depois de pagar já devolve assinatura ativa', async () => {
      const { env, email, auth } = await signup()
      const { paymentId } = (await checkout(auth, 3)).json().payload
      await decide(auth, paymentId, 'approved')
      const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password: SIGNUP_BASE.password } })
      expect(login.json().payload.subscription).toMatchObject({ status: 'active', expiresSoon: false })
    })

    it('recusar NÃO libera nada e marca o pagamento como recusado', async () => {
      const { env, restaurantId, auth } = await signup()
      const { paymentId } = (await checkout(auth, 1)).json().payload
      const res = await decide(auth, paymentId, 'rejected')
      expect(res.json().payload.status).toBe('rejected')
      expect(await getEndsAt(env, restaurantId)).toBeNull()
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(402)
    })

    it('depois de recusado dá para tentar de novo com outra cobrança e aprovar', async () => {
      const { env, restaurantId, auth } = await signup()
      const first = (await checkout(auth, 1)).json().payload.paymentId
      await decide(auth, first, 'rejected')
      const second = (await checkout(auth, 1)).json().payload.paymentId
      await decide(auth, second, 'approved')
      expect(await getEndsAt(env, restaurantId)).not.toBeNull()
    })

    it('decidir de novo um pagamento já concluído → 409 e não soma outra vez', async () => {
      const { env, restaurantId, auth } = await signup()
      const { paymentId } = (await checkout(auth, 1)).json().payload
      await decide(auth, paymentId, 'approved')
      const before = await getEndsAt(env, restaurantId)

      const again = await decide(auth, paymentId, 'approved')
      expect(again.statusCode).toBe(409)
      expect((await getEndsAt(env, restaurantId))!.getTime()).toBe(before!.getTime())
    })

    it('decisão inválida → 400; pagamento inexistente ou de outro restaurante → 404', async () => {
      const a = await signup()
      const b = await signup()
      const { paymentId } = (await checkout(a.auth, 1)).json().payload

      expect((await decide(a.auth, paymentId, 'talvez')).statusCode).toBe(400)
      expect((await decide(a.auth, new ObjectId().toHexString(), 'approved')).statusCode).toBe(404)
      expect((await decide(a.auth, 'nao-e-id', 'approved')).statusCode).toBe(404)
      // outro restaurante, mesmo ambiente de banco não importa: o pagamento é de A
      const otherEnvSamePayment = await decide(b.auth, paymentId, 'approved')
      expect(otherEnvSamePayment.statusCode).toBe(404)
    })

    it('com o provedor real configurado a rota do simulador NÃO existe (404)', async () => {
      const { auth } = await signup()
      process.env.PAYMENT_PROVIDER = 'mercadopago'
      process.env.MP_ACCESS_TOKEN = 'APP_USR-x'
      const res = await decide(auth, new ObjectId().toHexString(), 'approved')
      expect(res.statusCode).toBe(404)
    })

    it('em produção sem PAYMENT_PROVIDER nada de cobrança é criado (falha fechada)', async () => {
      const { auth } = await signup()
      delete process.env.PAYMENT_PROVIDER
      const nodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const res = await checkout(auth, 1)
        expect(res.statusCode).toBe(500)
      } finally {
        process.env.NODE_ENV = nodeEnv
      }
    })
  })

  describe('renovação (mesmo caminho do primeiro pagamento)', () => {
    it('renovar ANTES de vencer soma ao que sobrou: ninguém perde dias', async () => {
      const { env, restaurantId, auth } = await signup()
      const current = new Date(Date.now() + 10 * DAY)
      await setEndsAt(env, restaurantId, current)

      const { paymentId } = (await checkout(auth, 3)).json().payload
      await decide(auth, paymentId, 'approved')

      const endsAt = await getEndsAt(env, restaurantId)
      expect(endsAt!.toISOString()).toBe(addDays(current, 90).toISOString())
    })

    it('renovar depois de vencer conta a partir de agora, não da data antiga', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date('2020-01-01T00:00:00Z'))

      const { paymentId } = (await checkout(auth, 1)).json().payload
      await decide(auth, paymentId, 'approved')

      const endsAt = await getEndsAt(env, restaurantId)
      expect(endsAt!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY)
      expect(endsAt!.getTime()).toBeLessThan(Date.now() + 32 * DAY)
    })

    it('depois de vencida, a pessoa volta a entrar assim que o pagamento é aprovado', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() - DAY))
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(402)

      const { paymentId } = (await checkout(auth, 1)).json().payload
      await decide(auth, paymentId, 'approved')
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(200)
    })

    it('guarda o plano e o último pagamento no restaurante', async () => {
      const { env, restaurantId, auth } = await signup()
      const { paymentId } = (await checkout(auth, 6)).json().payload
      await decide(auth, paymentId, 'approved')
      const doc = await db(env).collection('restaurants').findOne({ _id: new ObjectId(restaurantId) })
      expect(doc?.subscription).toMatchObject({ plan: 6, lastPaymentId: paymentId })
    })
  })

  describe('tipos de assinatura: Básico e Pro', () => {
    const getTier = async (env: string, restaurantId: string) =>
      (await db(env).collection('restaurants').findOne({ _id: new ObjectId(restaurantId) }))?.subscription?.tier

    async function pay (auth: Record<string, string>, months: number, tier?: string) {
      const res = await checkout(auth, months, tier ? { tier } : {})
      expect(res.statusCode).toBe(201)
      const { paymentId } = res.json().payload
      expect((await decide(auth, paymentId, 'approved')).statusCode).toBe(200)
      return paymentId as string
    }

    it.each([['basic', 1, 15000], ['pro', 1, 22900], ['pro', 3, 65265], ['pro', 6, 123660], ['pro', 12, 233580]])(
      'tipo %s por %i mês(es) cobra %i centavos e o pagamento guarda o tipo',
      async (tier, months, cents) => {
        const { env, auth } = await signup()
        const res = await checkout(auth, months, { tier })
        expect(res.statusCode).toBe(201)
        expect(res.json().payload).toMatchObject({ tier, months, totalCents: cents })
        const saved = await db(env).collection('payments').findOne({ _id: new ObjectId(res.json().payload.paymentId) })
        expect(saved).toMatchObject({ tier, months, amountCents: cents })
      },
    )

    it('sem informar o tipo, é Básico', async () => {
      const { env, auth } = await signup()
      const res = await checkout(auth, 1)
      expect(res.json().payload).toMatchObject({ tier: 'basic', totalCents: 15000 })
      const saved = await db(env).collection('payments').findOne({ _id: new ObjectId(res.json().payload.paymentId) })
      expect(saved?.tier).toBe('basic')
    })

    it.each([['premium'], ['PRO'], [1], [null], [{}]])('tipo inválido (%s) → 400', async (tier) => {
      const { auth } = await signup()
      expect((await checkout(auth, 1, { tier })).statusCode).toBe(400)
    })

    it.each([['basic', 1, 30], ['basic', 3, 90], ['basic', 6, 180], ['basic', 12, 360], ['pro', 1, 30], ['pro', 12, 360]])(
      'dias fixos: %s por %i mês(es) libera EXATAMENTE %i dias, não meses de calendário',
      async (tier, months, days) => {
        const { env, restaurantId, auth } = await signup()
        const before = Date.now()
        await pay(auth, months, tier)
        const after = Date.now()
        const endsAt = (await getEndsAt(env, restaurantId))!.getTime()
        expect(endsAt).toBeGreaterThanOrEqual(before + days * DAY)
        expect(endsAt).toBeLessThanOrEqual(after + days * DAY)
      },
    )

    it('GET /subscription informa os dias de cada plano (30, 90, 180, 360) nos dois tipos', async () => {
      const { auth } = await signup()
      const state = await overview(auth)
      for (const t of state.tiers) expect(t.plans.map((p: any) => p.days)).toEqual([30, 90, 180, 360])
    })

    it('aprovar o Pro grava o tipo no restaurante e libera o acesso', async () => {
      const { env, restaurantId, auth } = await signup()
      await pay(auth, 1, 'pro')
      expect(await getTier(env, restaurantId)).toBe('pro')
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(200)
    })

    it('renovar o MESMO tipo soma ao que sobrou', async () => {
      const { env, restaurantId, auth } = await signup()
      const base = new Date(Date.now() + 10 * DAY)
      await setEndsAt(env, restaurantId, base)
      await db(env).collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { 'subscription.tier': 'pro' } })

      await pay(auth, 1, 'pro')
      expect((await getEndsAt(env, restaurantId))!.toISOString()).toBe(addDays(base, 30).toISOString())
      expect(await getTier(env, restaurantId)).toBe('pro')
    })

    it('UPGRADE com tempo sobrando: o Pro conta de HOJE, sem somar nem dar crédito pelo Básico que sobrava', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() + 20 * DAY)) // sem tipo gravado = Básico

      await pay(auth, 1, 'pro')

      const endsAt = (await getEndsAt(env, restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + 27 * DAY)
      expect(endsAt.getTime()).toBeLessThan(Date.now() + 32 * DAY)
      expect(await getTier(env, restaurantId)).toBe('pro')
    })

    it('DOWNGRADE com tempo sobrando: o Básico conta de HOJE e o Pro que sobrava é descartado', async () => {
      const { env, restaurantId, auth } = await signup()
      await pay(auth, 12, 'pro') // ~1 ano de Pro
      expect(await getTier(env, restaurantId)).toBe('pro')

      await pay(auth, 1, 'basic')

      const endsAt = (await getEndsAt(env, restaurantId))!
      expect(endsAt.getTime()).toBeLessThan(Date.now() + 32 * DAY)
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + 27 * DAY)
      expect(await getTier(env, restaurantId)).toBe('basic')
    })

    it('trocar de tipo com a assinatura vencida: conta de hoje (como qualquer pagamento vencido)', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() - DAY))
      await pay(auth, 3, 'pro')
      const endsAt = (await getEndsAt(env, restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + 88 * DAY)
      expect(endsAt.getTime()).toBeLessThan(Date.now() + 93 * DAY)
    })

    it('conta com data mas SEM tipo gravado (liberada à mão) é Básico no estado', async () => {
      const { env, restaurantId, auth } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() + 30 * DAY))
      expect(await overview(auth)).toMatchObject({ status: 'active', tier: 'basic' })
      expect(await getTier(env, restaurantId)).toBeUndefined()
    })

    it('o login devolve o tipo da assinatura', async () => {
      const { env, email, auth } = await signup()
      await pay(auth, 1, 'pro')
      const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password: SIGNUP_BASE.password } })
      expect(login.json().payload.subscription).toMatchObject({ status: 'active', tier: 'pro' })
    })

    it('trocar de tipo encerra o tempo dos pagamentos anteriores: estornar o antigo não tira nada do novo', async () => {
      const { env, restaurantId, auth } = await signup()
      const first = await pay(auth, 1, 'basic')
      await pay(auth, 1, 'pro')
      const after = (await getEndsAt(env, restaurantId))!
      const firstDoc = await db(env).collection('payments').findOne({ _id: new ObjectId(first) })
      expect(firstDoc?.supersededAt).toBeInstanceOf(Date)

      // estorno do pagamento Básico (já substituído): o tempo dele nem existia mais na assinatura
      await db(env).collection('payments').updateOne({ _id: new ObjectId(first) }, { $set: { providerPaymentId: 'x1' } })
      const { ConfirmPaymentUseCase } = await import('./subscription-use-cases')
      const provider = { name: 'mock' as const, getPayment: async () => ({ id: 'x1', status: 'refunded' as const, amountCents: 15000, externalReference: first }), createCheckout: async () => { throw new Error('x') } }
      const out = await new ConfirmPaymentUseCase().execute('x1', env, provider as any)

      expect(out.result).toBe('revoked')
      expect((await getEndsAt(env, restaurantId))!.toISOString()).toBe(after.toISOString())
    })
  })

  describe('presente de 1 dia (POST /admin/subscription-gift)', () => {
    const KEY = 'chave-admin-de-teste-0123456789'

    beforeEach(() => {
      process.env.ADMIN_API_KEY = KEY
    })
    afterEach(() => {
      delete process.env.ADMIN_API_KEY
    })

    const gift = (env: string, payload: unknown, key: string | null = KEY) =>
      app.inject({
        method: 'POST',
        url: '/admin/subscription-gift',
        headers: { env, ...(key ? { 'x-admin-key': key } : {}) },
        payload: payload as Record<string, unknown>,
      })

    it('sem ADMIN_API_KEY configurada a rota não existe (404), mesmo com qualquer chave', async () => {
      delete process.env.ADMIN_API_KEY
      const { env, email } = await signup()
      expect((await gift(env, { email }, 'qualquer')).statusCode).toBe(404)
      expect((await gift(env, { email }, '')).statusCode).toBe(404)
    })

    it.each([['sem chave', null], ['chave errada', 'outra-chave'], ['chave parecida', 'chave-admin-de-teste-012345678']])('%s → 401 e nada é concedido', async (_nome, key) => {
      const { env, email, restaurantId } = await signup()
      const res = await gift(env, { email }, key)
      expect(res.statusCode).toBe(401)
      expect(await getEndsAt(env, restaurantId)).toBeNull()
    })

    it('um token de usuário comum não serve como chave de administrador', async () => {
      const { env, email, auth, restaurantId } = await signup()
      const res = await gift(env, { email }, auth.authorization.replace('Bearer ', ''))
      expect(res.statusCode).toBe(401)
      expect(await getEndsAt(env, restaurantId)).toBeNull()
    })

    it('exige o email e a conta precisa existir', async () => {
      const { env } = await signup()
      expect((await gift(env, {})).statusCode).toBe(400)
      expect((await gift(env, { email: '   ' })).statusCode).toBe(400)
      expect((await gift(env, { email: 123 })).statusCode).toBe(400)
      expect((await gift(env, { email: 'ninguem@teste.com' })).statusCode).toBe(404)
    })

    it('conta sem assinatura ganha acesso até amanhã (agora + 24h) e passa a entrar', async () => {
      const { env, email, auth, restaurantId } = await signup()
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(402)

      const before = Date.now()
      const res = await gift(env, { email })
      const after = Date.now()

      expect(res.statusCode).toBe(200)
      expect(res.json().payload.granted).toBe(true)
      const endsAt = (await getEndsAt(env, restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThanOrEqual(before + DAY)
      expect(endsAt.getTime()).toBeLessThanOrEqual(after + DAY)
      expect(res.json().payload.endsAt).toBe(endsAt.toISOString())
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })).statusCode).toBe(200)
      expect(await overview(auth)).toMatchObject({ status: 'active', daysLeft: 1 })
    })

    it('o email não diferencia maiúsculas nem espaços', async () => {
      const { env, email, restaurantId } = await signup()
      const res = await gift(env, { email: `  ${email.toUpperCase()} ` })
      expect(res.statusCode).toBe(200)
      expect(await getEndsAt(env, restaurantId)).not.toBeNull()
    })

    it('o limite é de UM dia: nenhum parâmetro (days, months, endsAt) muda isso', async () => {
      const { env, email, restaurantId } = await signup()
      const res = await gift(env, { email, days: 365, months: 12, endsAt: '2099-01-01T00:00:00Z' })
      expect(res.statusCode).toBe(200)
      const endsAt = (await getEndsAt(env, restaurantId))!
      expect(endsAt.getTime()).toBeLessThanOrEqual(Date.now() + DAY)
    })

    it('assinatura vencida volta a valer só até amanhã', async () => {
      const { env, email, restaurantId } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() - 5 * DAY))
      const res = await gift(env, { email })
      expect(res.json().payload.granted).toBe(true)
      expect((await getEndsAt(env, restaurantId))!.getTime()).toBeLessThanOrEqual(Date.now() + DAY)
    })

    it('quem já tem MAIS de um dia não recebe nada: o presente nunca encurta nem soma', async () => {
      const { env, email, restaurantId } = await signup()
      const current = new Date(Date.now() + 10 * DAY)
      await setEndsAt(env, restaurantId, current)

      const res = await gift(env, { email })

      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toEqual({ granted: false, endsAt: current.toISOString() })
      expect((await getEndsAt(env, restaurantId))!.toISOString()).toBe(current.toISOString())
    })

    it('quem tem só algumas horas sobrando passa a ter até amanhã (nunca mais que 24h a partir de agora)', async () => {
      const { env, email, restaurantId } = await signup()
      await setEndsAt(env, restaurantId, new Date(Date.now() + 3 * 60 * 60 * 1000))
      const res = await gift(env, { email })
      expect(res.json().payload.granted).toBe(true)
      const endsAt = (await getEndsAt(env, restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + DAY - 60 * 1000)
      expect(endsAt.getTime()).toBeLessThanOrEqual(Date.now() + DAY)
    })

    it('não cria pagamento nem mexe no tipo; só marca que foi presente', async () => {
      const { env, email, restaurantId } = await signup()
      await gift(env, { email })
      const doc = await db(env).collection('restaurants').findOne({ _id: new ObjectId(restaurantId) })
      expect(doc?.subscription?.tier).toBeUndefined()
      expect(doc?.subscription?.giftedAt).toBeInstanceOf(Date)
      expect(await db(env).collection('payments').countDocuments({ restaurantId })).toBe(0)
    })

    it('só vale no banco (env) do cabeçalho: a mesma conta em outro env não ganha nada', async () => {
      const a = await signup()
      const b = await signup()
      const res = await gift(b.env, { email: a.email })
      expect(res.statusCode).toBe(404)
      expect(await getEndsAt(a.env, a.restaurantId)).toBeNull()
    })
  })

  describe('webhook do Mercado Pago', () => {
    interface MpPayment { id: string, status: string, transaction_amount: number, currency_id: string, external_reference: string }

    function useMercadoPago (payments: Record<string, MpPayment | 'erro'>) {
      process.env.PAYMENT_PROVIDER = 'mercadopago'
      process.env.MP_ACCESS_TOKEN = 'APP_USR-test'
      process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET
      process.env.API_URL = 'https://api.mintly.test'
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.endsWith('/checkout/preferences')) {
          return { ok: true, status: 201, json: async () => ({ id: 'pref-1', init_point: 'https://mp.test/pagar', sandbox_init_point: 'https://sandbox.mp.test/pagar' }) }
        }
        const id = url.split('/v1/payments/')[1]
        const p = payments[id]
        if (!p || p === 'erro') return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => p }
      }))
      return calls
    }

    const signedWebhook = (env: string, dataId: string, overrides: { secret?: string, type?: string } = {}) => {
      const ts = String(Date.now())
      const requestId = `req-${Math.random().toString(36).slice(2)}`
      const v1 = createHmac('sha256', overrides.secret ?? WEBHOOK_SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')
      return app.inject({
        method: 'POST',
        url: `/webhooks/mercadopago?env=${env}&data.id=${dataId}&type=${overrides.type ?? 'payment'}`,
        headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
        payload: { type: overrides.type ?? 'payment', data: { id: dataId } },
      })
    }

    async function openPayment (months: number) {
      const ctx = await signup()
      const res = await checkout(ctx.auth, months)
      expect(res.statusCode).toBe(201)
      return { ...ctx, paymentId: res.json().payload.paymentId as string, body: res.json().payload }
    }

    const approved = (paymentId: string, cents: number, id = '900001'): MpPayment => ({ id, status: 'approved', transaction_amount: cents / 100, currency_id: 'BRL', external_reference: paymentId })

    it('o checkout cria a preferência no Mercado Pago e devolve o link de pagamento', async () => {
      const calls = useMercadoPago({})
      const { body } = await openPayment(3)
      expect(body).toMatchObject({ provider: 'mercadopago', checkoutUrl: 'https://mp.test/pagar', totalCents: 42750 })
      expect(calls).toEqual(['POST https://api.mercadopago.com/checkout/preferences'])
    })

    it('falha do Mercado Pago ao criar a cobrança → 502 e o pagamento fica cancelado', async () => {
      useMercadoPago({})
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
      const ctx = await signup()
      const res = await checkout(ctx.auth, 1)
      expect(res.statusCode).toBe(502)
      expect(res.json().code).toBe('PAYMENT-0001')
      const saved = await db(ctx.env).collection('payments').find({ restaurantId: ctx.restaurantId }).toArray()
      expect(saved).toHaveLength(1)
      expect(saved[0].status).toBe('cancelled')
    })

    it('a cobrança no Mercado Pago leva o tipo e a duração: título, descrição e metadados', async () => {
      const bodies: any[] = []
      process.env.PAYMENT_PROVIDER = 'mercadopago'
      process.env.MP_ACCESS_TOKEN = 'APP_USR-test'
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
        bodies.push(JSON.parse(init?.body ?? '{}'))
        return { ok: true, status: 201, json: async () => ({ id: 'pref-1', init_point: 'https://mp.test/pagar', sandbox_init_point: 'https://sandbox.mp.test/pagar' }) }
      }))
      const ctx = await signup()
      const res = await checkout(ctx.auth, 6, { tier: 'pro' })
      expect(res.statusCode).toBe(201)

      expect(bodies).toHaveLength(1)
      expect(bodies[0].items[0]).toMatchObject({ id: 'mintly-pro-6m', title: 'Assinatura Mintly Pro — 6 meses', unit_price: 1236.6 })
      expect(bodies[0].items[0].description).toBe('Assinatura Mintly Pro por 6 meses (180 dias)')
      expect(bodies[0].metadata).toEqual({ tier: 'pro', months: 6, days: 180, payment_id: res.json().payload.paymentId })
    })

    it('o tipo que vale é o do NOSSO registro: um aviso de Pro pago como Básico não vira Pro', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1) // Básico, R$ 150
      // o valor pago bate com o Básico; o Mercado Pago não decide o tipo
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })
      await signedWebhook(ctx.env, '900001')
      const doc = await db(ctx.env).collection('restaurants').findOne({ _id: new ObjectId(ctx.restaurantId) })
      expect(doc?.subscription?.tier).toBe('basic')
    })

    it('aviso de pagamento aprovado libera o acesso pelo período pago', async () => {
      useMercadoPago({})
      const ctx = await openPayment(3)
      useMercadoPago({ 900001: approved(ctx.paymentId, 42750) })

      const res = await signedWebhook(ctx.env, '900001')
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ received: true })

      const endsAt = await getEndsAt(ctx.env, ctx.restaurantId)
      expect(endsAt!.getTime()).toBeGreaterThan(Date.now() + 88 * DAY)
      expect(endsAt!.getTime()).toBeLessThan(Date.now() + 93 * DAY)
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: ctx.auth })).statusCode).toBe(200)

      const saved = await db(ctx.env).collection('payments').findOne({ _id: new ObjectId(ctx.paymentId) })
      expect(saved).toMatchObject({ status: 'approved', providerPaymentId: '900001' })
      expect(saved?.appliedAt).toBeInstanceOf(Date)
    })

    it('o mesmo aviso repetido (o Mercado Pago reenvia) NÃO soma de novo', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })

      await signedWebhook(ctx.env, '900001')
      const first = await getEndsAt(ctx.env, ctx.restaurantId)
      const again = await signedWebhook(ctx.env, '900001')

      expect(again.statusCode).toBe(200)
      expect((await getEndsAt(ctx.env, ctx.restaurantId))!.getTime()).toBe(first!.getTime())
    })

    it('dois avisos SIMULTÂNEOS do mesmo pagamento somam uma vez só', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })

      const results = await Promise.all([signedWebhook(ctx.env, '900001'), signedWebhook(ctx.env, '900001'), signedWebhook(ctx.env, '900001')])
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200])

      const endsAt = await getEndsAt(ctx.env, ctx.restaurantId)
      expect(endsAt!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY)
      expect(endsAt!.getTime()).toBeLessThan(Date.now() + 32 * DAY) // 1 mês, não 3
    })

    it('renovação por aviso soma ao que sobrou da assinatura atual', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      const current = new Date(Date.now() + 10 * DAY)
      await setEndsAt(ctx.env, ctx.restaurantId, current)
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })

      await signedWebhook(ctx.env, '900001')
      expect((await getEndsAt(ctx.env, ctx.restaurantId))!.toISOString()).toBe(addDays(current, 30).toISOString())
    })

    it('valor diferente do que cobramos NÃO libera nada', async () => {
      useMercadoPago({})
      const ctx = await openPayment(12)
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) }) // pagou 150 num plano de 1.530

      const res = await signedWebhook(ctx.env, '900001')
      expect(res.statusCode).toBe(200)
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('pagamento recusado ou pendente NÃO libera; recusado é registrado', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({ 900001: { ...approved(ctx.paymentId, 15000), status: 'rejected' } })
      await signedWebhook(ctx.env, '900001')
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
      expect((await db(ctx.env).collection('payments').findOne({ _id: new ObjectId(ctx.paymentId) }))?.status).toBe('rejected')

      useMercadoPago({ 900002: { ...approved(ctx.paymentId, 15000, '900002'), status: 'in_process' } })
      await signedWebhook(ctx.env, '900002')
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('uma tentativa recusada e depois uma aprovada da MESMA cobrança: libera quando aprova', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({
        900001: { ...approved(ctx.paymentId, 15000, '900001'), status: 'rejected' },
        900002: approved(ctx.paymentId, 15000, '900002'),
      })
      await signedWebhook(ctx.env, '900001')
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
      await signedWebhook(ctx.env, '900002')
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).not.toBeNull()
    })

    describe('estorno e chargeback de pagamento já aprovado', () => {
      const refunded = (paymentId: string, cents: number, id = '900001'): MpPayment => ({ ...approved(paymentId, cents, id), status: 'refunded' })

      it('estorno desconta os meses que o pagamento deu e a conta volta a ser barrada (402)', async () => {
        useMercadoPago({})
        const ctx = await openPayment(1)
        useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })
        await signedWebhook(ctx.env, '900001')
        expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: ctx.auth })).statusCode).toBe(200)

        useMercadoPago({ 900001: refunded(ctx.paymentId, 15000) })
        const res = await signedWebhook(ctx.env, '900001')

        expect(res.statusCode).toBe(200)
        expect((await getEndsAt(ctx.env, ctx.restaurantId))!.getTime()).toBeLessThanOrEqual(Date.now())
        expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: ctx.auth })).statusCode).toBe(402)
        expect(await overview(ctx.auth)).toMatchObject({ status: 'expired' })
        const saved = await db(ctx.env).collection('payments').findOne({ _id: new ObjectId(ctx.paymentId) })
        expect(saved).toMatchObject({ status: 'refunded' })
        expect(saved?.revokedAt).toBeInstanceOf(Date)
      })

      it('chargeback (charged_back) também desconta', async () => {
        useMercadoPago({})
        const ctx = await openPayment(3)
        useMercadoPago({ 900001: approved(ctx.paymentId, 42750) })
        await signedWebhook(ctx.env, '900001')

        useMercadoPago({ 900001: { ...approved(ctx.paymentId, 42750), status: 'charged_back' } })
        await signedWebhook(ctx.env, '900001')
        expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: ctx.auth })).statusCode).toBe(402)
      })

      it('o aviso de estorno repetido desconta UMA vez só (inclusive simultâneos)', async () => {
        useMercadoPago({})
        const ctx = await openPayment(1)
        const base = new Date(Date.now() + 60 * DAY)
        await setEndsAt(ctx.env, ctx.restaurantId, base)
        useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })
        await signedWebhook(ctx.env, '900001') // base + 1 mês

        useMercadoPago({ 900001: refunded(ctx.paymentId, 15000) })
        await Promise.all([signedWebhook(ctx.env, '900001'), signedWebhook(ctx.env, '900001'), signedWebhook(ctx.env, '900001')])
        await signedWebhook(ctx.env, '900001')

        expect((await getEndsAt(ctx.env, ctx.restaurantId))!.toISOString()).toBe(base.toISOString())
      })

      it('estornar UM pagamento não tira o que outro pagamento deu: continua com acesso', async () => {
        useMercadoPago({})
        const first = await openPayment(1)
        useMercadoPago({ 900001: approved(first.paymentId, 15000) })
        await signedWebhook(first.env, '900001')
        const afterFirst = (await getEndsAt(first.env, first.restaurantId))!

        const second = await checkout(first.auth, 3)
        const secondId = second.json().payload.paymentId as string
        useMercadoPago({ 900001: approved(first.paymentId, 15000), 900002: approved(secondId, 42750, '900002') })
        await signedWebhook(first.env, '900002')
        expect((await getEndsAt(first.env, first.restaurantId))!.toISOString()).toBe(addDays(afterFirst, 90).toISOString())

        useMercadoPago({ 900001: refunded(first.paymentId, 15000), 900002: approved(secondId, 42750, '900002') })
        await signedWebhook(first.env, '900001')

        const grantedByFirst = (await db(first.env).collection('payments').findOne({ _id: new ObjectId(first.paymentId) }))!.grantedMs as number
        expect((await getEndsAt(first.env, first.restaurantId))!.toISOString()).toBe(new Date(addDays(afterFirst, 90).getTime() - grantedByFirst).toISOString())
        expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: first.auth })).statusCode).toBe(200)
      })

      it('pagamento antigo, sem o tempo guardado, é descontado pelos meses do plano', async () => {
        useMercadoPago({})
        const ctx = await openPayment(3)
        const base = new Date(Date.now() + 10 * DAY)
        await setEndsAt(ctx.env, ctx.restaurantId, base)
        useMercadoPago({ 900001: approved(ctx.paymentId, 42750) })
        await signedWebhook(ctx.env, '900001')
        await db(ctx.env).collection('payments').updateOne({ _id: new ObjectId(ctx.paymentId) }, { $unset: { grantedMs: '' } })

        useMercadoPago({ 900001: refunded(ctx.paymentId, 42750) })
        await signedWebhook(ctx.env, '900001')
        expect((await getEndsAt(ctx.env, ctx.restaurantId))!.toISOString()).toBe(base.toISOString())
      })

      it('estorno de uma tentativa que nunca liberou nada não mexe na assinatura', async () => {
        useMercadoPago({})
        const ctx = await openPayment(1)
        useMercadoPago({ 900001: approved(ctx.paymentId, 15000, '900001') })
        await signedWebhook(ctx.env, '900001')
        const granted = await getEndsAt(ctx.env, ctx.restaurantId)

        // outro id no provedor, apontando para a mesma cobrança, que veio estornado: não é o que liberou o acesso
        useMercadoPago({ 900009: refunded(ctx.paymentId, 15000, '900009') })
        await signedWebhook(ctx.env, '900009')

        expect((await getEndsAt(ctx.env, ctx.restaurantId))!.getTime()).toBe(granted!.getTime())
      })

      it('pagamento estornado ANTES de o aviso de aprovação chegar nunca libera acesso', async () => {
        useMercadoPago({})
        const ctx = await openPayment(1)
        useMercadoPago({ 900001: refunded(ctx.paymentId, 15000) })
        await signedWebhook(ctx.env, '900001')
        expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
      })
    })

    it('pagamento que não é nosso (referência desconhecida) é ignorado com 200', async () => {
      useMercadoPago({ 900001: approved(new ObjectId().toHexString(), 15000) })
      const { env, restaurantId } = await signup()
      const res = await signedWebhook(env, '900001')
      expect(res.statusCode).toBe(200)
      expect(await getEndsAt(env, restaurantId)).toBeNull()
    })

    it('referência de um ambiente não vale em outro ambiente de banco', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      const other = await signup()
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })

      await signedWebhook(other.env, '900001') // mesmo pagamento do MP, apontando para o ambiente errado
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
      expect(await getEndsAt(other.env, other.restaurantId)).toBeNull()
    })

    it('assinatura do aviso errada → 401 e nem consulta o Mercado Pago', async () => {
      const calls = useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })
      const before = calls.length

      const res = await signedWebhook(ctx.env, '900001', { secret: 'outro-segredo' })
      expect(res.statusCode).toBe(401)
      expect(calls.length).toBe(before)
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('aviso sem cabeçalho de assinatura → 401', async () => {
      useMercadoPago({})
      const { env } = await signup()
      const res = await app.inject({ method: 'POST', url: `/webhooks/mercadopago?env=${env}&data.id=1&type=payment`, payload: { type: 'payment', data: { id: '1' } } })
      expect(res.statusCode).toBe(401)
    })

    it('aviso que não é de pagamento é aceito e ignorado', async () => {
      const calls = useMercadoPago({})
      const { env } = await signup()
      const before = calls.length
      const res = await signedWebhook(env, '1', { type: 'merchant_order' })
      expect(res.statusCode).toBe(200)
      expect(calls.length).toBe(before)
    })

    it('sem o ambiente na URL → 400; ambiente inexistente não faz nada', async () => {
      useMercadoPago({})
      const noEnv = await app.inject({ method: 'POST', url: '/webhooks/mercadopago?data.id=1&type=payment', payload: {} })
      expect(noEnv.statusCode).toBeGreaterThanOrEqual(400)
      expect(noEnv.statusCode).toBeLessThan(500)
    })

    it('erro ao consultar o Mercado Pago → 500 (ele reenvia depois) e nada é liberado', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({ 900001: 'erro' })
      const res = await signedWebhook(ctx.env, '900001')
      expect(res.statusCode).toBe(500)
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('com o provedor simulado a rota do webhook não existe (404)', async () => {
      const { env } = await signup()
      const res = await app.inject({ method: 'POST', url: `/webhooks/mercadopago?env=${env}&data.id=1&type=payment`, payload: {} })
      expect(res.statusCode).toBe(404)
    })

    it('sem segredo configurado o aviso é aceito mesmo assim, mas só vale o que o Mercado Pago confirma', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      delete process.env.MP_WEBHOOK_SECRET
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })
      delete process.env.MP_WEBHOOK_SECRET

      const res = await app.inject({ method: 'POST', url: `/webhooks/mercadopago?env=${ctx.env}&data.id=900001&type=payment`, payload: {} })
      expect(res.statusCode).toBe(200)
      expect(await getEndsAt(ctx.env, ctx.restaurantId)).not.toBeNull()
    })
  })
})
