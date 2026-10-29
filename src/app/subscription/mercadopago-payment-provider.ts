import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CheckoutInput, CheckoutOutput, PaymentProvider, PaymentStatus, ProviderPayment, WebhookRequest } from './payment-provider'
import { UnauthorizedError } from '../../core/errors/auth/unauthorized-error'

export interface MercadoPagoConfig {
  accessToken: string
  /** Segredo da assinatura do webhook (painel do Mercado Pago > Webhooks). Sem ele, o aviso não é autenticado,
   *  mas isso NÃO concede nada: o pagamento é sempre reconsultado na API do Mercado Pago antes de valer. */
  webhookSecret?: string
  apiUrl: string
  frontendUrl: string
  /** Usa o `sandbox_init_point` (modo de teste do Mercado Pago). */
  sandbox: boolean
}

const API = 'https://api.mercadopago.com'

/** Estados do Mercado Pago -> estados do Mintly. Qualquer estado desconhecido é tratado como pendente (não libera nada). */
export function mapMercadoPagoStatus (status: string | undefined): PaymentStatus {
  switch (status) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'cancelled':
      return 'cancelled'
    case 'refunded':
    case 'charged_back':
      return 'refunded'
    default:
      return 'pending'
  }
}

export function configFromEnv (env: Record<string, string | undefined> = process.env): MercadoPagoConfig {
  return {
    accessToken: env.MP_ACCESS_TOKEN ?? '',
    webhookSecret: env.MP_WEBHOOK_SECRET || undefined,
    apiUrl: (env.API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    frontendUrl: (env.FRONTEND_URL ?? 'http://localhost:4200').replace(/\/$/, ''),
    sandbox: env.MP_SANDBOX === 'true',
  }
}

/**
 * Mercado Pago, Checkout Pro: criamos uma "preferência" e levamos a pessoa à página de pagamento do
 * Mercado Pago (cartão, Pix, boleto). A confirmação NÃO é a volta do navegador: é o webhook, que só
 * serve de gatilho para consultarmos o pagamento aqui (`getPayment`) com o nosso token.
 */
export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const

  constructor (
    private readonly config: MercadoPagoConfig = configFromEnv(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers (extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json', ...extra }
  }

  async createCheckout (input: CheckoutInput): Promise<CheckoutOutput> {
    const back = `${this.config.frontendUrl}/assinatura/retorno`
    const body = {
      items: [{
        id: input.paymentId,
        title: input.title,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: input.amountCents / 100,
      }],
      external_reference: input.paymentId,
      // O webhook não manda o header `env`: o ambiente (banco) do tenant vai na própria URL.
      notification_url: `${this.config.apiUrl}/webhooks/mercadopago?env=${encodeURIComponent(input.env)}`,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      statement_descriptor: 'MINTLY',
      ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
    }
    const res = await this.fetchImpl(`${API}/checkout/preferences`, {
      method: 'POST',
      headers: this.headers({ 'X-Idempotency-Key': input.paymentId }),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Mercado Pago recusou criar a cobrança (HTTP ${res.status}).`)
    const json = (await res.json()) as { id?: string, init_point?: string, sandbox_init_point?: string }
    const checkoutUrl = this.config.sandbox ? json.sandbox_init_point : json.init_point
    if (!json.id || !checkoutUrl) throw new Error('Resposta do Mercado Pago sem link de pagamento.')
    return { providerReference: json.id, checkoutUrl }
  }

  async getPayment (providerPaymentId: string): Promise<ProviderPayment> {
    const res = await this.fetchImpl(`${API}/v1/payments/${encodeURIComponent(providerPaymentId)}`, { headers: this.headers() })
    if (!res.ok) throw new Error(`Mercado Pago não devolveu o pagamento ${providerPaymentId} (HTTP ${res.status}).`)
    const p = (await res.json()) as { id: number | string, status?: string, transaction_amount?: number, currency_id?: string, external_reference?: string }
    return {
      id: String(p.id),
      status: p.currency_id && p.currency_id !== 'BRL' ? 'pending' : mapMercadoPagoStatus(p.status),
      amountCents: Math.round((p.transaction_amount ?? 0) * 100),
      externalReference: p.external_reference ?? '',
    }
  }

  parseWebhook (request: WebhookRequest): { providerPaymentId: string } | null {
    const body = (request.body ?? {}) as { type?: string, action?: string, data?: { id?: string | number } }
    const dataId = String(request.query['data.id'] ?? body.data?.id ?? '')
    const type = String(request.query.type ?? request.query.topic ?? body.type ?? '')

    if (this.config.webhookSecret) this.assertSignature(request, dataId)

    if (type !== 'payment' || !dataId) return null
    return { providerPaymentId: dataId }
  }

  /** x-signature: "ts=…,v1=…"; v1 = HMAC-SHA256(segredo, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"). */
  private assertSignature (request: WebhookRequest, dataId: string): void {
    const header = String(request.headers['x-signature'] ?? '')
    const requestId = String(request.headers['x-request-id'] ?? '')
    const parts = Object.fromEntries(header.split(',').map((kv) => {
      const [k, ...v] = kv.trim().split('=')
      return [k, v.join('=')]
    }))
    const ts = parts.ts
    const v1 = parts.v1
    if (!ts || !v1) throw new UnauthorizedError('Assinatura do webhook ausente')

    const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId
    const manifest = `id:${id};request-id:${requestId};ts:${ts};`
    const expected = createHmac('sha256', this.config.webhookSecret as string).update(manifest).digest('hex')

    const a = Buffer.from(expected)
    const b = Buffer.from(v1)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError('Assinatura do webhook inválida')
  }
}
