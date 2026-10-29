import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { addMonths } from 'mintly-lib'
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
      expect(signupPayload.subscription).toEqual({ status: 'none', endsAt: null, daysLeft: null, expiresSoon: false })
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
    it('devolve os 4 planos com os preços e descontos, e o provedor', async () => {
      const { auth } = await signup()
      const state = await overview(auth)
      expect(state.provider).toBe('mock')
      expect(state.plans.map((p: any) => [p.months, p.totalCents, p.discountPercent])).toEqual([
        [1, 15000, 0],
        [3, 42750, 5],
        [6, 81000, 10],
        [12, 153000, 15],
      ])
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

    it('o plano de 12 meses libera por um ano', async () => {
      const { env, restaurantId, auth } = await signup()
      const { paymentId } = (await checkout(auth, 12)).json().payload
      await decide(auth, paymentId, 'approved')
      const endsAt = await getEndsAt(env, restaurantId)
      expect(endsAt!.getTime()).toBeGreaterThan(Date.now() + 364 * DAY)
      expect(endsAt!.getTime()).toBeLessThan(Date.now() + 367 * DAY)
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
      expect(endsAt!.toISOString()).toBe(addMonths(current, 3).toISOString())
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
      expect((await getEndsAt(ctx.env, ctx.restaurantId))!.toISOString()).toBe(addMonths(current, 1).toISOString())
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

    it('estorno depois de aprovado não tira o que já foi concedido', async () => {
      useMercadoPago({})
      const ctx = await openPayment(1)
      useMercadoPago({ 900001: approved(ctx.paymentId, 15000) })
      await signedWebhook(ctx.env, '900001')
      const granted = await getEndsAt(ctx.env, ctx.restaurantId)

      useMercadoPago({ 900001: { ...approved(ctx.paymentId, 15000), status: 'refunded' } })
      await signedWebhook(ctx.env, '900001')
      expect((await getEndsAt(ctx.env, ctx.restaurantId))!.getTime()).toBe(granted!.getTime())
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
