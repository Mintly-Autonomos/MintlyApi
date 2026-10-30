import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { ensureAllIndexes } from '../../infrastructure/db/indices'
import { buildServer } from '../../infrastructure/server/build-server'

// Este spec exercita o portão de assinatura DE VERDADE (os demais testes de integração o substituem).
vi.unmock('../../core/hooks/require-active-subscription')

const DAY = 24 * 60 * 60 * 1000
const WEBHOOK_SECRET = 'segredo-do-webhook'
let envCounter = 0
const freshEnv = () => `int_rec_${++envCounter}`

describe('Renovação automática (Integration)', () => {
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
    const email = `dono_${env}@teste.com`
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: 'Dono Renovação', phone: '11977777777' }, email, password: 'Senha123', restaurantName: 'Resto', termsAccepted: true },
    })
    expect(res.statusCode).toBe(201)
    const payload = res.json().payload
    await ensureAllIndexes(env)
    return { env, email, restaurantId: payload.user.restaurantId as string, auth: { env, authorization: `Bearer ${payload.accessToken}` } }
  }

  const db = (env: string) => mongoConnection.getDatabase(env)
  const restaurant = async (env: string, restaurantId: string) =>
    db(env).collection('restaurants').findOne({ _id: new ObjectId(restaurantId) })
  const endsAtOf = async (env: string, restaurantId: string): Promise<Date | null> => (await restaurant(env, restaurantId))?.subscription?.endsAt ?? null
  const overview = async (auth: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/subscription', headers: auth })).json().payload
  const checkout = (auth: Record<string, string>, months: number, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/subscription/checkout', headers: auth, payload: { months, ...extra } })
  const decide = (auth: Record<string, string>, paymentId: string, decision: string) =>
    app.inject({ method: 'POST', url: '/subscription/mock/decide', headers: auth, payload: { paymentId, decision } })
  const post = (auth: Record<string, string>, url: string) => app.inject({ method: 'POST', url, headers: auth })
  const payments = (env: string, restaurantId: string) => db(env).collection('payments').find({ restaurantId }).sort({ createdAt: 1 }).toArray()

  describe('simulador (PAYMENT_PROVIDER=mock)', () => {
    async function subscribeRecurring (months = 1, tier = 'basic') {
      const ctx = await signup()
      const res = await checkout(ctx.auth, months, { tier, autoRenew: true })
      expect(res.statusCode).toBe(201)
      const { paymentId } = res.json().payload
      expect((await decide(ctx.auth, paymentId, 'approved')).statusCode).toBe(200)
      return { ...ctx, paymentId, body: res.json().payload }
    }

    it('o checkout com autoRenew cria o registro de renovação e avisa na resposta', async () => {
      const ctx = await signup()
      const res = await checkout(ctx.auth, 3, { tier: 'pro', autoRenew: true })
      expect(res.statusCode).toBe(201)
      expect(res.json().payload).toMatchObject({ autoRenew: true, tier: 'pro', months: 3, totalCents: 65265 })
      const saved = await db(ctx.env).collection('payments').findOne({ _id: new ObjectId(res.json().payload.paymentId) })
      expect(saved).toMatchObject({ kind: 'recurring', tier: 'pro', months: 3 })
      expect(saved?.preapprovalId).toBe(`mock-pre-${res.json().payload.paymentId}`)
      // ainda não autorizada: nada de renovação ativa
      expect((await overview(ctx.auth)).recurring).toBeNull()
    })

    it('pagamento único continua sendo o padrão (sem renovação)', async () => {
      const ctx = await signup()
      const res = await checkout(ctx.auth, 1)
      expect(res.json().payload.autoRenew).toBe(false)
      const saved = await db(ctx.env).collection('payments').findOne({ _id: new ObjectId(res.json().payload.paymentId) })
      expect(saved?.kind).toBeUndefined()
      await decide(ctx.auth, res.json().payload.paymentId, 'approved')
      expect((await overview(ctx.auth)).recurring).toBeNull()
    })

    it.each([['sim'], [1], [null]])('autoRenew inválido (%s) → 400', async (autoRenew) => {
      const ctx = await signup()
      expect((await checkout(ctx.auth, 1, { autoRenew })).statusCode).toBe(400)
    })

    it('aprovar a primeira cobrança libera os dias e deixa a renovação ativa', async () => {
      const ctx = await subscribeRecurring(3, 'pro')
      const endsAt = (await endsAtOf(ctx.env, ctx.restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + 89 * DAY)
      expect(endsAt.getTime()).toBeLessThan(Date.now() + 91 * DAY)
      const state = await overview(ctx.auth)
      expect(state.recurring).toMatchObject({ status: 'authorized', tier: 'pro', months: 3, days: 90 })
      expect(typeof state.recurring.startedAt).toBe('string')
    })

    it('recusar a primeira cobrança não ativa renovação nem dá acesso', async () => {
      const ctx = await signup()
      const { paymentId } = (await checkout(ctx.auth, 1, { autoRenew: true })).json().payload
      await decide(ctx.auth, paymentId, 'rejected')
      expect(await endsAtOf(ctx.env, ctx.restaurantId)).toBeNull()
      expect((await overview(ctx.auth)).recurring).toBeNull()
    })

    it('a cobrança do próximo ciclo SOMA os dias do plano ao que sobrou, com registro próprio', async () => {
      const ctx = await subscribeRecurring(1)
      const first = (await endsAtOf(ctx.env, ctx.restaurantId))!
      const startedAt = (await overview(ctx.auth)).recurring.startedAt

      const res = await post(ctx.auth, '/subscription/mock/charge-next')

      expect(res.statusCode).toBe(200)
      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(first.getTime() + 30 * DAY)
      const records = await payments(ctx.env, ctx.restaurantId)
      expect(records).toHaveLength(2)
      expect(records[1]).toMatchObject({ kind: 'recurring', status: 'approved', amountCents: 15000 })
      expect(records[1].appliedAt).toBeInstanceOf(Date)
      expect((await overview(ctx.auth)).recurring.startedAt).toBe(startedAt)
    })

    it('vários ciclos seguidos somam um de cada vez', async () => {
      const ctx = await subscribeRecurring(1)
      const first = (await endsAtOf(ctx.env, ctx.restaurantId))!
      for (let i = 0; i < 3; i++) await post(ctx.auth, '/subscription/mock/charge-next')
      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(first.getTime() + 90 * DAY)
      expect(await payments(ctx.env, ctx.restaurantId)).toHaveLength(4)
    })

    it('com a assinatura vencida, a cobrança do ciclo conta de agora', async () => {
      const ctx = await subscribeRecurring(1)
      await db(ctx.env).collection('restaurants').updateOne({ _id: new ObjectId(ctx.restaurantId) }, { $set: { 'subscription.endsAt': new Date(Date.now() - 5 * DAY) } })
      await post(ctx.auth, '/subscription/mock/charge-next')
      const endsAt = (await endsAtOf(ctx.env, ctx.restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
      expect(endsAt.getTime()).toBeLessThan(Date.now() + 31 * DAY)
    })

    it('cancelar a renovação mantém o acesso até a data e impede novas cobranças', async () => {
      const ctx = await subscribeRecurring(1)
      const endsAt = (await endsAtOf(ctx.env, ctx.restaurantId))!

      const res = await post(ctx.auth, '/subscription/cancel-renewal')

      expect(res.statusCode).toBe(200)
      expect(res.json().payload).toEqual({ status: 'cancelled' })
      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(endsAt.getTime())
      expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: ctx.auth })).statusCode).toBe(200)
      expect((await overview(ctx.auth)).recurring.status).toBe('cancelled')
      expect((await post(ctx.auth, '/subscription/mock/charge-next')).statusCode).toBe(409)
    })

    it('cancelar duas vezes é inofensivo; sem renovação, 404', async () => {
      const ctx = await subscribeRecurring(1)
      expect((await post(ctx.auth, '/subscription/cancel-renewal')).statusCode).toBe(200)
      expect((await post(ctx.auth, '/subscription/cancel-renewal')).statusCode).toBe(200)
      const other = await signup()
      expect((await post(other.auth, '/subscription/cancel-renewal')).statusCode).toBe(404)
    })

    it('cancelar exige login', async () => {
      const ctx = await signup()
      const res = await app.inject({ method: 'POST', url: '/subscription/cancel-renewal', headers: { env: ctx.env } })
      expect(res.statusCode).toBe(401)
    })

    it('"próxima cobrança" sem renovação ativa → 409', async () => {
      const ctx = await signup()
      expect((await post(ctx.auth, '/subscription/mock/charge-next')).statusCode).toBe(409)
    })

    it('um pagamento único depois não mexe na renovação', async () => {
      const ctx = await subscribeRecurring(1)
      const { paymentId } = (await checkout(ctx.auth, 1)).json().payload
      await decide(ctx.auth, paymentId, 'approved')
      expect((await overview(ctx.auth)).recurring).toMatchObject({ status: 'authorized', months: 1 })
    })
  })

  describe('Mercado Pago (assinatura / preapproval)', () => {
    interface Remote {
      preapprovals: Record<string, { status?: string, external_reference?: string } | 'erro'>
      authorized: Record<string, { preapproval_id: string, payment?: { id: number | string } | null } | 'erro'>
      payments: Record<string, { status: string, transaction_amount: number, currency_id?: string, external_reference?: string } | 'erro'>
      cancelFails?: boolean
    }
    const calls: { method: string, url: string, body?: any }[] = []
    let preSeq = 0
    let lastPreId = ''

    function useMercadoPago (remote: Remote) {
      process.env.PAYMENT_PROVIDER = 'mercadopago'
      process.env.MP_ACCESS_TOKEN = 'APP_USR-test'
      process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET
      process.env.API_URL = 'https://api.mintly.test'
      calls.length = 0
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string, body?: string }) => {
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(init.body) : undefined
        calls.push({ method, url, body })
        if (url.endsWith('/preapproval') && method === 'POST') {
          lastPreId = `PRE-${++preSeq}`
          return { ok: true, status: 201, json: async () => ({ id: lastPreId, init_point: 'https://mp.test/assinar', sandbox_init_point: 'https://sandbox.mp.test/assinar' }) }
        }
        const pre = /\/preapproval\/([^/?]+)$/.exec(url)
        if (pre && method === 'PUT') return remote.cancelFails ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: pre[1], status: body.status }) }
        if (pre) {
          const p = remote.preapprovals[pre[1]]
          return !p || p === 'erro' ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: pre[1], ...p }) }
        }
        const ap = /\/authorized_payments\/([^/?]+)$/.exec(url)
        if (ap) {
          const a = remote.authorized[ap[1]]
          return !a || a === 'erro' ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: ap[1], ...a }) }
        }
        const pay = /\/v1\/payments\/([^/?]+)$/.exec(url)
        if (pay) {
          const p = remote.payments[pay[1]]
          return !p || p === 'erro' ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: pay[1], currency_id: 'BRL', ...p }) }
        }
        return { ok: false, status: 500, json: async () => ({}) }
      }))
    }

    const sign = (dataId: string, secret = WEBHOOK_SECRET) => {
      const ts = String(Date.now())
      const requestId = `req-${Math.random().toString(36).slice(2)}`
      const v1 = createHmac('sha256', secret).update(`id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};request-id:${requestId};ts:${ts};`).digest('hex')
      return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId }
    }
    /** Aviso do painel do Mercado Pago: SEM o ambiente na URL. */
    const webhook = (type: string, dataId: string, opts: { secret?: string, env?: string } = {}) =>
      app.inject({
        method: 'POST',
        url: `/webhooks/mercadopago?data.id=${dataId}&type=${type}${opts.env ? `&env=${opts.env}` : ''}`,
        headers: sign(dataId, opts.secret),
        payload: { type, data: { id: dataId } },
      })

    const empty = (): Remote => ({ preapprovals: {}, authorized: {}, payments: {} })

    /** Abre uma renovação (checkout) e devolve ids para montar as respostas do Mercado Pago. */
    async function openRecurring (months = 1, tier = 'basic') {
      const ctx = await signup()
      useMercadoPago(empty())
      const res = await checkout(ctx.auth, months, { tier, autoRenew: true })
      expect(res.statusCode).toBe(201)
      const { paymentId, totalCents } = res.json().payload
      const preId = lastPreId
      return { ...ctx, paymentId: paymentId as string, totalCents: totalCents as number, preId, ref: `${ctx.env}|${paymentId}` }
    }

    const cycle = (ctx: { preId: string, ref: string, totalCents: number }, n: number, over: Partial<Remote['payments'][string] & object> = {}) => {
      const remote = empty()
      remote.preapprovals[ctx.preId] = { status: 'authorized', external_reference: ctx.ref }
      remote.authorized[`AP${n}`] = { preapproval_id: ctx.preId, payment: { id: `9000${n}` } }
      remote.payments[`9000${n}`] = { status: 'approved', transaction_amount: ctx.totalCents / 100, external_reference: ctx.ref, ...over } as any
      return remote
    }

    it('o checkout cria a assinatura no Mercado Pago: dias, valor, e-mail e referência com o ambiente', async () => {
      const ctx = await signup()
      useMercadoPago(empty())
      const res = await checkout(ctx.auth, 6, { tier: 'pro', autoRenew: true })
      expect(res.statusCode).toBe(201)
      expect(res.json().payload).toMatchObject({ autoRenew: true, provider: 'mercadopago', checkoutUrl: 'https://mp.test/assinar', totalCents: 123660 })

      const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/preapproval'))!
      expect(create.body).toMatchObject({
        payer_email: ctx.email,
        status: 'pending',
        back_url: expect.stringContaining('/assinatura/retorno'),
        auto_recurring: { frequency: 180, frequency_type: 'days', transaction_amount: 1236.6, currency_id: 'BRL' },
        external_reference: `${ctx.env}|${res.json().payload.paymentId}`,
      })
      expect(create.body.reason).toContain('Pro')
      expect(calls.some((c) => c.url.endsWith('/checkout/preferences'))).toBe(false)
    })

    it('falha do Mercado Pago ao criar a assinatura → 502 e o registro fica cancelado', async () => {
      const ctx = await signup()
      useMercadoPago(empty())
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
      const res = await checkout(ctx.auth, 1, { autoRenew: true })
      expect(res.statusCode).toBe(502)
      expect((await payments(ctx.env, ctx.restaurantId))[0].status).toBe('cancelled')
    })

    it('a 1ª cobrança chega pelo painel (sem ambiente na URL): libera os dias e ativa a renovação', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))

      const res = await webhook('subscription_authorized_payment', 'AP1')

      expect(res.statusCode).toBe(200)
      const endsAt = (await endsAtOf(ctx.env, ctx.restaurantId))!
      expect(endsAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
      expect(endsAt.getTime()).toBeLessThan(Date.now() + 31 * DAY)
      expect((await overview(ctx.auth)).recurring).toMatchObject({ status: 'authorized', tier: 'basic', months: 1, days: 30 })
      const [record] = await payments(ctx.env, ctx.restaurantId)
      expect(record).toMatchObject({ status: 'approved', providerPaymentId: '90001', preapprovalId: ctx.preId })
    })

    it('o ciclo seguinte soma os dias e ganha registro próprio', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      const first = (await endsAtOf(ctx.env, ctx.restaurantId))!

      useMercadoPago({ ...cycle(ctx, 2), payments: { ...cycle(ctx, 1).payments, ...cycle(ctx, 2).payments } })
      const res = await webhook('subscription_authorized_payment', 'AP2')

      expect(res.statusCode).toBe(200)
      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(first.getTime() + 30 * DAY)
      const records = await payments(ctx.env, ctx.restaurantId)
      expect(records).toHaveLength(2)
      expect(records.map((r) => r.providerPaymentId)).toEqual(['90001', '90002'])
    })

    it('o mesmo aviso repetido, ou o aviso de "payment" da mesma cobrança, soma UMA vez só', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      const once = (await endsAtOf(ctx.env, ctx.restaurantId))!

      await webhook('subscription_authorized_payment', 'AP1')
      await webhook('payment', '90001')
      await Promise.all([webhook('subscription_authorized_payment', 'AP1'), webhook('payment', '90001', { env: ctx.env })])

      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(once.getTime())
      expect(await payments(ctx.env, ctx.restaurantId)).toHaveLength(1)
    })

    it('duas cobranças do mesmo ciclo chegando juntas somam uma vez só', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      const first = (await endsAtOf(ctx.env, ctx.restaurantId))!
      const remote2 = { ...cycle(ctx, 2), payments: { ...cycle(ctx, 1).payments, ...cycle(ctx, 2).payments } }
      useMercadoPago(remote2)

      await Promise.all([webhook('subscription_authorized_payment', 'AP2'), webhook('subscription_authorized_payment', 'AP2'), webhook('payment', '90002')])

      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(first.getTime() + 30 * DAY)
      expect(await payments(ctx.env, ctx.restaurantId)).toHaveLength(2)
    })

    it('valor diferente do que cobramos NÃO libera nada', async () => {
      const ctx = await openRecurring(3)
      useMercadoPago(cycle(ctx, 1, { transaction_amount: 1 }))
      await webhook('subscription_authorized_payment', 'AP1')
      expect(await endsAtOf(ctx.env, ctx.restaurantId)).toBeNull()
      expect((await overview(ctx.auth)).recurring).toBeNull()
    })

    it('pagamento não aprovado (recusado) não libera nada e não ativa renovação', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1, { status: 'rejected' }))
      await webhook('subscription_authorized_payment', 'AP1')
      expect(await endsAtOf(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('cobrança ainda sem pagamento (agendada ou em nova tentativa) é ignorada', async () => {
      const ctx = await openRecurring(1)
      const remote = cycle(ctx, 1)
      remote.authorized.AP1 = { preapproval_id: ctx.preId, payment: null }
      useMercadoPago(remote)
      const res = await webhook('subscription_authorized_payment', 'AP1')
      expect(res.statusCode).toBe(200)
      expect(await endsAtOf(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('ciclo recusado no meio: não soma, e a assinatura vence normalmente (sem tolerância)', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      const first = (await endsAtOf(ctx.env, ctx.restaurantId))!
      useMercadoPago({ ...cycle(ctx, 2, { status: 'rejected' }), payments: { 90002: { status: 'rejected', transaction_amount: ctx.totalCents / 100, external_reference: ctx.ref } } })
      await webhook('subscription_authorized_payment', 'AP2')
      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(first.getTime())
    })

    it('a assinatura de OUTRO plano (preapproval diferente) não vale para este registro', async () => {
      const ctx = await openRecurring(1)
      const remote = cycle(ctx, 1)
      remote.preapprovals.OUTRA = { status: 'authorized', external_reference: ctx.ref }
      remote.authorized.AP1 = { preapproval_id: 'OUTRA', payment: { id: '90001' } }
      useMercadoPago(remote)
      await webhook('subscription_authorized_payment', 'AP1')
      expect(await endsAtOf(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('referência de um ambiente desconhecido ou inexistente é ignorada com 200', async () => {
      const ctx = await openRecurring(1)
      const remote = cycle(ctx, 1)
      remote.preapprovals[ctx.preId] = { status: 'authorized', external_reference: 'sem-ambiente' }
      useMercadoPago(remote)
      const res = await webhook('subscription_authorized_payment', 'AP1')
      expect(res.statusCode).toBe(200)
      expect(await endsAtOf(ctx.env, ctx.restaurantId)).toBeNull()
    })

    it('falha ao consultar o Mercado Pago → 500 (o Mercado Pago reenvia)', async () => {
      useMercadoPago({ ...empty(), authorized: { AP1: 'erro' } })
      expect((await webhook('subscription_authorized_payment', 'AP1')).statusCode).toBe(500)
    })

    it('estorno de UM ciclo desconta só os dias daquela cobrança', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      useMercadoPago({ ...cycle(ctx, 2), payments: { ...cycle(ctx, 1).payments, ...cycle(ctx, 2).payments } })
      await webhook('subscription_authorized_payment', 'AP2')
      const both = (await endsAtOf(ctx.env, ctx.restaurantId))!

      const refunded = { ...cycle(ctx, 2), payments: { ...cycle(ctx, 1).payments, 90002: { ...cycle(ctx, 2).payments['90002'] as any, status: 'refunded' } } }
      useMercadoPago(refunded)
      await webhook('payment', '90002')
      await webhook('payment', '90002')

      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(both.getTime() - 30 * DAY)
    })

    it('aviso da assinatura: cancelada ou pausada no Mercado Pago atualiza o estado', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')

      useMercadoPago({ ...empty(), preapprovals: { [ctx.preId]: { status: 'paused', external_reference: ctx.ref } } })
      expect((await webhook('subscription_preapproval', ctx.preId)).statusCode).toBe(200)
      expect((await overview(ctx.auth)).recurring.status).toBe('paused')

      useMercadoPago({ ...empty(), preapprovals: { [ctx.preId]: { status: 'cancelled', external_reference: ctx.ref } } })
      await webhook('subscription_preapproval', ctx.preId)
      expect((await overview(ctx.auth)).recurring.status).toBe('cancelled')
    })

    it('aviso de uma assinatura que não é de nenhum restaurante é ignorado', async () => {
      useMercadoPago({ ...empty(), preapprovals: { DESCONHECIDA: { status: 'cancelled', external_reference: `${freshEnv()}|x` } } })
      const res = await webhook('subscription_preapproval', 'DESCONHECIDA')
      expect(res.statusCode).toBe(200)
    })

    it('tópicos que não são nossos (ex.: planos) são ignorados', async () => {
      useMercadoPago(empty())
      expect((await webhook('subscription_preapproval_plan', 'PLANO1')).statusCode).toBe(200)
      expect(calls).toHaveLength(0)
    })

    it('assinatura do aviso errada → 401 e nada é consultado', async () => {
      useMercadoPago(empty())
      expect((await webhook('subscription_authorized_payment', 'AP1', { secret: 'outro' })).statusCode).toBe(401)
      expect(calls).toHaveLength(0)
    })

    it('cancelar a renovação cancela a assinatura no Mercado Pago e o acesso continua', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      const endsAt = (await endsAtOf(ctx.env, ctx.restaurantId))!

      const res = await post(ctx.auth, '/subscription/cancel-renewal')

      expect(res.statusCode).toBe(200)
      const put = calls.find((c) => c.method === 'PUT')!
      expect(put.url).toContain(`/preapproval/${ctx.preId}`)
      expect(put.body).toEqual({ status: 'cancelled' })
      expect((await endsAtOf(ctx.env, ctx.restaurantId))!.getTime()).toBe(endsAt.getTime())
      expect((await overview(ctx.auth)).recurring.status).toBe('cancelled')
    })

    it('se o Mercado Pago recusar cancelar → 502 e a renovação segue ativa', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')
      useMercadoPago({ ...empty(), cancelFails: true })

      const res = await post(ctx.auth, '/subscription/cancel-renewal')

      expect(res.statusCode).toBe(502)
      expect((await overview(ctx.auth)).recurring.status).toBe('authorized')
    })

    it('trocar de plano com uma renovação NOVA cancela a antiga no Mercado Pago (não cobra duas vezes)', async () => {
      const ctx = await openRecurring(1)
      useMercadoPago(cycle(ctx, 1))
      await webhook('subscription_authorized_payment', 'AP1')

      useMercadoPago(empty())
      const res = await checkout(ctx.auth, 3, { tier: 'pro', autoRenew: true })
      const newPre = lastPreId
      const newRef = `${ctx.env}|${res.json().payload.paymentId}`
      const remote = empty()
      remote.preapprovals[newPre] = { status: 'authorized', external_reference: newRef }
      remote.authorized.AP9 = { preapproval_id: newPre, payment: { id: '95001' } }
      remote.payments['95001'] = { status: 'approved', transaction_amount: res.json().payload.totalCents / 100, external_reference: newRef }
      useMercadoPago(remote)
      await webhook('subscription_authorized_payment', 'AP9')

      expect((await overview(ctx.auth)).recurring).toMatchObject({ status: 'authorized', tier: 'pro', months: 3 })
      const cancelled = calls.filter((c) => c.method === 'PUT')
      expect(cancelled).toHaveLength(1)
      expect(cancelled[0].url).toContain(`/preapproval/${ctx.preId}`)
    })

    it('renovação automática não existe em ambiente sem suporte: simulador "mock/charge-next" some (404)', async () => {
      const ctx = await signup()
      useMercadoPago(empty())
      expect((await post(ctx.auth, '/subscription/mock/charge-next')).statusCode).toBe(404)
    })
  })
})
