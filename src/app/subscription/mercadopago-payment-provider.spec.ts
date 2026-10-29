import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  MercadoPagoPaymentProvider,
  configFromEnv,
  mapMercadoPagoStatus,
} from './mercadopago-payment-provider'
import type { MercadoPagoConfig } from './mercadopago-payment-provider'

const baseConfig: MercadoPagoConfig = {
  accessToken: 'APP_USR-token',
  apiUrl: 'https://api.mintly.test',
  frontendUrl: 'https://app.mintly.test',
  sandbox: false,
}

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as unknown as Response

describe('mapMercadoPagoStatus', () => {
  it('traduz os estados do Mercado Pago', () => {
    expect(mapMercadoPagoStatus('approved')).toBe('approved')
    expect(mapMercadoPagoStatus('rejected')).toBe('rejected')
    expect(mapMercadoPagoStatus('cancelled')).toBe('cancelled')
    expect(mapMercadoPagoStatus('refunded')).toBe('refunded')
    expect(mapMercadoPagoStatus('charged_back')).toBe('refunded')
  })

  it('pendente, em análise, desconhecido ou ausente NUNCA viram aprovado', () => {
    for (const s of ['pending', 'in_process', 'authorized', 'in_mediation', 'algo-novo', undefined]) {
      expect(mapMercadoPagoStatus(s)).toBe('pending')
    }
  })
})

describe('configFromEnv', () => {
  it('lê as variáveis e tira a barra final das URLs', () => {
    const cfg = configFromEnv({ MP_ACCESS_TOKEN: 'tok', MP_WEBHOOK_SECRET: 'seg', API_URL: 'https://api/', FRONTEND_URL: 'https://app/', MP_SANDBOX: 'true' } as Record<string, string | undefined>)
    expect(cfg).toEqual({ accessToken: 'tok', webhookSecret: 'seg', apiUrl: 'https://api', frontendUrl: 'https://app', sandbox: true })
  })

  it('defaults de desenvolvimento; segredo vazio vira ausente', () => {
    const cfg = configFromEnv({ MP_WEBHOOK_SECRET: '' } as Record<string, string | undefined>)
    expect(cfg).toMatchObject({ accessToken: '', webhookSecret: undefined, apiUrl: 'http://localhost:3000', frontendUrl: 'http://localhost:4200', sandbox: false })
  })
})

describe('MercadoPagoPaymentProvider.createCheckout', () => {
  const input = { paymentId: 'pay123', env: 'staging', title: 'Assinatura Mintly — 3 meses', amountCents: 42750, payerEmail: 'dono@rest.com' }

  it('cria a preferência com valor em reais, referência externa e URLs de volta/aviso', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'pref-1', init_point: 'https://mp.test/pagar', sandbox_init_point: 'https://sandbox.mp.test/pagar' }))
    const provider = new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch)

    const out = await provider.createCheckout(input)

    expect(out).toEqual({ providerReference: 'pref-1', checkoutUrl: 'https://mp.test/pagar' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences')
    expect(init.headers.Authorization).toBe('Bearer APP_USR-token')
    expect(init.headers['X-Idempotency-Key']).toBe('pay123')
    const body = JSON.parse(init.body)
    expect(body.items[0]).toMatchObject({ quantity: 1, currency_id: 'BRL', unit_price: 427.5 })
    expect(body.external_reference).toBe('pay123')
    expect(body.notification_url).toBe('https://api.mintly.test/webhooks/mercadopago?env=staging')
    expect(body.back_urls).toEqual({ success: 'https://app.mintly.test/assinatura/retorno', pending: 'https://app.mintly.test/assinatura/retorno', failure: 'https://app.mintly.test/assinatura/retorno' })
    expect(body.auto_return).toBe('approved')
    expect(body.payer).toEqual({ email: 'dono@rest.com' })
  })

  it('no modo de teste usa o link do sandbox', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'pref-1', init_point: 'https://mp.test/pagar', sandbox_init_point: 'https://sandbox.mp.test/pagar' }))
    const provider = new MercadoPagoPaymentProvider({ ...baseConfig, sandbox: true }, fetchImpl as unknown as typeof fetch)
    expect((await provider.createCheckout(input)).checkoutUrl).toBe('https://sandbox.mp.test/pagar')
  })

  it('sem e-mail do pagador não manda o campo payer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'p', init_point: 'https://x' }))
    await new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).createCheckout({ ...input, payerEmail: undefined })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('payer')
  })

  it('o ambiente com caracteres especiais vai codificado na URL do webhook', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'p', init_point: 'https://x' }))
    await new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).createCheckout({ ...input, env: 'a b&c' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).notification_url).toContain('env=a%20b%26c')
  })

  it('erro HTTP do Mercado Pago vira erro (sem vazar o token)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'invalid' }, 401))
    const provider = new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch)
    await expect(provider.createCheckout(input)).rejects.toThrow('HTTP 401')
    await expect(provider.createCheckout(input)).rejects.not.toThrow('APP_USR-token')
  })

  it('resposta sem link de pagamento é erro', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'p' }))
    await expect(new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).createCheckout(input)).rejects.toThrow('sem link')
  })
})

describe('MercadoPagoPaymentProvider.getPayment', () => {
  it('consulta o pagamento e devolve estado, valor em centavos e referência', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 987, status: 'approved', transaction_amount: 427.5, currency_id: 'BRL', external_reference: 'pay123' }))
    const provider = new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch)

    expect(await provider.getPayment('987')).toEqual({ id: '987', status: 'approved', amountCents: 42750, externalReference: 'pay123' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.mercadopago.com/v1/payments/987')
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer APP_USR-token')
  })

  it('arredonda o valor ao centavo (sem erro de ponto flutuante)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, status: 'approved', transaction_amount: 810.1 + 0.2, currency_id: 'BRL', external_reference: 'x' }))
    expect((await new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).getPayment('1')).amountCents).toBe(81030)
  })

  it('moeda diferente de BRL nunca é aprovada', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, status: 'approved', transaction_amount: 150, currency_id: 'USD', external_reference: 'x' }))
    expect((await new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).getPayment('1')).status).toBe('pending')
  })

  it('pagamento sem referência externa volta com referência vazia (não casa com nenhuma cobrança)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, status: 'approved', transaction_amount: 1, currency_id: 'BRL' }))
    expect((await new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).getPayment('1')).externalReference).toBe('')
  })

  it('erro HTTP vira erro (o webhook responde 500 e o Mercado Pago tenta de novo)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404))
    await expect(new MercadoPagoPaymentProvider(baseConfig, fetchImpl as unknown as typeof fetch).getPayment('1')).rejects.toThrow('HTTP 404')
  })
})

describe('MercadoPagoPaymentProvider.parseWebhook', () => {
  const sign = (secret: string, dataId: string, requestId: string, ts: string) =>
    createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')

  const noSecret = new MercadoPagoPaymentProvider(baseConfig, vi.fn() as unknown as typeof fetch)
  const withSecret = new MercadoPagoPaymentProvider({ ...baseConfig, webhookSecret: 'segredo' }, vi.fn() as unknown as typeof fetch)

  it('aviso de pagamento: devolve o id a consultar (query data.id)', () => {
    expect(noSecret.parseWebhook({ headers: {}, query: { 'data.id': '987', type: 'payment' }, body: {} })).toEqual({ providerPaymentId: '987' })
  })

  it('aceita o id e o tipo no corpo', () => {
    expect(noSecret.parseWebhook({ headers: {}, query: {}, body: { type: 'payment', data: { id: 555 } } })).toEqual({ providerPaymentId: '555' })
  })

  it('aceita topic=payment (formato antigo)', () => {
    expect(noSecret.parseWebhook({ headers: {}, query: { topic: 'payment', 'data.id': '1' }, body: null })).toEqual({ providerPaymentId: '1' })
  })

  it('aviso que não é de pagamento (ex.: pedido do comerciante) é ignorado', () => {
    expect(noSecret.parseWebhook({ headers: {}, query: { 'data.id': '9', type: 'merchant_order' }, body: {} })).toBeNull()
  })

  it('aviso de pagamento sem id é ignorado', () => {
    expect(noSecret.parseWebhook({ headers: {}, query: { type: 'payment' }, body: {} })).toBeNull()
  })

  it('com segredo: assinatura correta passa', () => {
    const ts = '1700000000'
    const v1 = sign('segredo', '987', 'req-1', ts)
    const out = withSecret.parseWebhook({ headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' }, query: { 'data.id': '987', type: 'payment' }, body: {} })
    expect(out).toEqual({ providerPaymentId: '987' })
  })

  it('com segredo: id alfanumérico é normalizado para minúsculas no manifesto', () => {
    const ts = '1700000000'
    const v1 = sign('segredo', 'abc123', 'req-1', ts)
    const out = withSecret.parseWebhook({ headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' }, query: { 'data.id': 'ABC123', type: 'payment' }, body: {} })
    expect(out).toEqual({ providerPaymentId: 'ABC123' })
  })

  it('com segredo: assinatura errada é recusada (401)', () => {
    expect(() => withSecret.parseWebhook({ headers: { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'r' }, query: { 'data.id': '987', type: 'payment' }, body: {} })).toThrow('inválida')
  })

  it('com segredo: assinatura de OUTRO pagamento não vale para este (id entra no manifesto)', () => {
    const ts = '1700000000'
    const v1 = sign('segredo', '111', 'req-1', ts)
    expect(() => withSecret.parseWebhook({ headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' }, query: { 'data.id': '222', type: 'payment' }, body: {} })).toThrow('inválida')
  })

  it('com segredo: sem cabeçalho de assinatura é recusado', () => {
    expect(() => withSecret.parseWebhook({ headers: {}, query: { 'data.id': '987', type: 'payment' }, body: {} })).toThrow('ausente')
  })

  it('com segredo: assinatura de tamanho diferente é recusada sem estourar', () => {
    expect(() => withSecret.parseWebhook({ headers: { 'x-signature': 'ts=1,v1=curta', 'x-request-id': 'r' }, query: { 'data.id': '987', type: 'payment' }, body: {} })).toThrow('inválida')
  })
})
