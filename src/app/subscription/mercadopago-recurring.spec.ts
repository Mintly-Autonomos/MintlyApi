import { describe, it, expect, vi } from 'vitest'
import { MercadoPagoPaymentProvider, mapMercadoPagoRecurringStatus } from './mercadopago-payment-provider'
import type { MercadoPagoConfig } from './mercadopago-payment-provider'
import { MockPaymentProvider } from './mock-payment-provider'
import { decodeReference, encodeReference } from './payment-reference'

const config: MercadoPagoConfig = {
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

const input = {
  paymentId: '665f0000000000000000abcd',
  env: 'staging',
  title: 'Assinatura Mintly Pro — 3 meses (renovação automática)',
  tier: 'pro' as const,
  months: 3 as const,
  days: 90,
  amountCents: 65265,
  payerEmail: 'dono@teste.com',
  frequencyDays: 90,
}

describe('referência com o ambiente', () => {
  it('codifica e decodifica ambiente e id', () => {
    expect(encodeReference('staging', 'abc')).toBe('staging|abc')
    expect(decodeReference('staging|abc')).toEqual({ env: 'staging', id: 'abc' })
  })

  it('referência de pagamento único (só o id) não tem ambiente', () => {
    expect(decodeReference('abc')).toEqual({ id: 'abc' })
    expect(decodeReference(undefined)).toEqual({ id: '' })
    expect(decodeReference('|abc')).toEqual({ env: undefined, id: 'abc' })
  })
})

describe('mapMercadoPagoRecurringStatus', () => {
  it('traduz os estados da assinatura; desconhecido é pendente', () => {
    expect(mapMercadoPagoRecurringStatus('authorized')).toBe('authorized')
    expect(mapMercadoPagoRecurringStatus('paused')).toBe('paused')
    expect(mapMercadoPagoRecurringStatus('cancelled')).toBe('cancelled')
    expect(mapMercadoPagoRecurringStatus('pending')).toBe('pending')
    expect(mapMercadoPagoRecurringStatus('qualquer')).toBe('pending')
    expect(mapMercadoPagoRecurringStatus(undefined)).toBe('pending')
  })
})

describe('MercadoPagoPaymentProvider (renovação automática)', () => {
  it('createRecurring: assinatura sem plano, cobrança de N em N dias, link de autorização', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'PRE1', init_point: 'https://mp.test/assinar', sandbox_init_point: 'https://sandbox.mp.test/assinar' }, 201))
    const p = new MercadoPagoPaymentProvider(config, fetchMock as unknown as typeof fetch)

    const out = await p.createRecurring(input)

    expect(out).toEqual({ providerReference: 'PRE1', checkoutUrl: 'https://mp.test/assinar' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/preapproval')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer APP_USR-token')
    expect(init.headers['X-Idempotency-Key']).toBe(input.paymentId)
    expect(JSON.parse(init.body)).toEqual({
      reason: input.title,
      external_reference: 'staging|665f0000000000000000abcd',
      payer_email: 'dono@teste.com',
      back_url: 'https://app.mintly.test/assinatura/retorno',
      auto_recurring: { frequency: 90, frequency_type: 'days', transaction_amount: 652.65, currency_id: 'BRL' },
      status: 'pending',
    })
  })

  it('createRecurring: modo de teste usa o link do sandbox (e cai no normal se ele faltar)', async () => {
    const sandbox = new MercadoPagoPaymentProvider({ ...config, sandbox: true }, vi.fn().mockResolvedValue(jsonResponse({ id: 'P', init_point: 'a', sandbox_init_point: 'b' })) as unknown as typeof fetch)
    expect((await sandbox.createRecurring(input)).checkoutUrl).toBe('b')
    const semSandbox = new MercadoPagoPaymentProvider({ ...config, sandbox: true }, vi.fn().mockResolvedValue(jsonResponse({ id: 'P', init_point: 'a' })) as unknown as typeof fetch)
    expect((await semSandbox.createRecurring(input)).checkoutUrl).toBe('a')
  })

  it('createRecurring: sem e-mail de quem assina não chama o Mercado Pago', async () => {
    const fetchMock = vi.fn()
    const p = new MercadoPagoPaymentProvider(config, fetchMock as unknown as typeof fetch)
    await expect(p.createRecurring({ ...input, payerEmail: undefined })).rejects.toThrow('e-mail')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('createRecurring: recusa do Mercado Pago e resposta sem link viram erro', async () => {
    const recusa = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({}, 400)) as unknown as typeof fetch)
    await expect(recusa.createRecurring(input)).rejects.toThrow('HTTP 400')
    const semLink = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({ id: 'P' }, 201)) as unknown as typeof fetch)
    await expect(semLink.createRecurring(input)).rejects.toThrow('sem link')
  })

  it('getPreapproval: estado traduzido e referência', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'PRE1', status: 'authorized', external_reference: 'staging|abc' }))
    const p = new MercadoPagoPaymentProvider(config, fetchMock as unknown as typeof fetch)
    expect(await p.getPreapproval('PRE1')).toEqual({ id: 'PRE1', status: 'authorized', externalReference: 'staging|abc' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/preapproval/PRE1')
  })

  it('getPreapproval: sem referência vira vazio; erro do Mercado Pago sobe', async () => {
    const p = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({ id: 'PRE1' })) as unknown as typeof fetch)
    expect((await p.getPreapproval('PRE1')).externalReference).toBe('')
    const erro = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch)
    await expect(erro.getPreapproval('PRE1')).rejects.toThrow('HTTP 404')
  })

  it('getAuthorizedPayment: assinatura e pagamento da cobrança (ou nenhum pagamento ainda)', async () => {
    const com = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({ id: 77, preapproval_id: 'PRE1', payment: { id: 9001 } })) as unknown as typeof fetch)
    expect(await com.getAuthorizedPayment('77')).toEqual({ id: '77', preapprovalId: 'PRE1', paymentId: '9001' })
    const sem = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({ id: 78, preapproval_id: 'PRE1' })) as unknown as typeof fetch)
    expect((await sem.getAuthorizedPayment('78')).paymentId).toBeNull()
    const erro = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({}, 500)) as unknown as typeof fetch)
    await expect(erro.getAuthorizedPayment('78')).rejects.toThrow('HTTP 500')
  })

  it('cancelRecurring: PUT com status cancelled; recusa sobe como erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'PRE1', status: 'cancelled' }))
    const p = new MercadoPagoPaymentProvider(config, fetchMock as unknown as typeof fetch)
    await p.cancelRecurring('PRE1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/preapproval/PRE1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ status: 'cancelled' })
    const erro = new MercadoPagoPaymentProvider(config, vi.fn().mockResolvedValue(jsonResponse({}, 500)) as unknown as typeof fetch)
    await expect(erro.cancelRecurring('PRE1')).rejects.toThrow('HTTP 500')
  })

  describe('parseWebhook: tópicos da renovação', () => {
    const p = new MercadoPagoPaymentProvider(config)
    const parse = (type: string, id = '123') => p.parseWebhook({ headers: {}, query: { 'data.id': id, type }, body: {} })

    it('cobrança e assinatura (nome novo e antigo)', () => {
      expect(parse('subscription_authorized_payment')).toEqual({ kind: 'authorized_payment', id: '123' })
      expect(parse('authorized_payment')).toEqual({ kind: 'authorized_payment', id: '123' })
      expect(parse('subscription_preapproval')).toEqual({ kind: 'preapproval', id: '123' })
      expect(parse('preapproval')).toEqual({ kind: 'preapproval', id: '123' })
    })

    it('planos e outros tópicos são ignorados; sem id também', () => {
      expect(parse('subscription_preapproval_plan')).toBeNull()
      expect(parse('merchant_order')).toBeNull()
      expect(p.parseWebhook({ headers: {}, query: { type: 'payment' }, body: {} })).toBeNull()
    })
  })
})

describe('MockPaymentProvider (renovação automática)', () => {
  it('createRecurring: mesma tela do simulador, com o id da assinatura simulada', async () => {
    const mock = new MockPaymentProvider({} as never, 'https://app.mintly.test')
    const out = await mock.createRecurring(input)
    expect(out.providerReference).toBe(`mock-pre-${input.paymentId}`)
    expect(out.checkoutUrl).toBe(`https://app.mintly.test/assinatura/simulador?pagamento=${input.paymentId}`)
  })

  it('cancelRecurring não faz nada (e não falha)', async () => {
    await expect(new MockPaymentProvider({} as never).cancelRecurring()).resolves.toBeUndefined()
  })
})
