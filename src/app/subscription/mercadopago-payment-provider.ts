import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  CheckoutInput,
  CheckoutOutput,
  PaymentProvider,
  PaymentStatus,
  ProviderAuthorizedPayment,
  ProviderPayment,
  ProviderPreapproval,
  RecurringInput,
  RecurringStatus,
  WebhookEvent,
  WebhookRequest,
} from './payment-provider'
import { encodeReference } from './payment-reference'
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

/** Estados da assinatura (preapproval) no Mercado Pago -> os do Mintly. Desconhecido = pendente (não mostra renovação ativa). */
export function mapMercadoPagoRecurringStatus (status: string | undefined): RecurringStatus {
  switch (status) {
    case 'authorized':
      return 'authorized'
    case 'paused':
      return 'paused'
    case 'cancelled':
      return 'cancelled'
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

  /**
   * Registra para onde o Mercado Pago vai mandar o aviso desta cobrança (sem segredos: só a URL e o ambiente).
   * É o que responde "por que o aviso não chegou?": o endereço sai do API_URL do deploy, não do que o site usa.
   */
  /** O endereço da API é localhost (API_URL ausente no deploy cai no padrão de desenvolvimento). */
  private apiUrlIsLocal (): boolean {
    try {
      return ['localhost', '127.0.0.1'].includes(new URL(this.config.apiUrl).hostname)
    } catch {
      return true
    }
  }

  private logNotificationTarget (paymentId: string, notificationUrl: string): void {
    console.log(`[mercadopago] cobrança ${paymentId}: aviso em ${notificationUrl}`)
    if (this.apiUrlIsLocal()) {
      console.warn('[mercadopago] API_URL não está configurado (ou aponta para localhost): o Mercado Pago não conseguirá avisar este pagamento.')
    }
  }

  async createCheckout (input: CheckoutInput): Promise<CheckoutOutput> {
    const back = `${this.config.frontendUrl}/assinatura/retorno`
    const notificationUrl = `${this.config.apiUrl}/webhooks/mercadopago?env=${encodeURIComponent(input.env)}`
    this.logNotificationTarget(input.paymentId, notificationUrl)
    const body = {
      items: [{
        id: `mintly-${input.tier}-${input.months}m`,
        title: input.title,
        description: `Assinatura Mintly ${input.tier === 'pro' ? 'Pro' : 'Básico'} por ${input.months} ${input.months === 1 ? 'mês' : 'meses'} (${input.days} dias)`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: input.amountCents / 100,
      }],
      external_reference: input.paymentId,
      // Informativo: quem vale é o registro do pagamento no Mintly (o aviso é sempre reconsultado e conferido).
      metadata: { tier: input.tier, months: input.months, days: input.days, payment_id: input.paymentId },
      // O webhook não manda o header `env`: o ambiente (banco) do tenant vai na própria URL.
      notification_url: notificationUrl,
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

  /**
   * Tópicos que importam: `payment` (pagamento único ou cobrança), `subscription_authorized_payment` (cada
   * cobrança da renovação) e `subscription_preapproval` (a assinatura foi autorizada, pausada ou cancelada).
   * Os demais (ex.: planos) são ignorados.
   */
  parseWebhook (request: WebhookRequest): WebhookEvent | null {
    const body = (request.body ?? {}) as { type?: string, action?: string, data?: { id?: string | number } }
    const dataId = String(request.query['data.id'] ?? body.data?.id ?? '')
    const type = String(request.query.type ?? request.query.topic ?? body.type ?? '')

    if (this.config.webhookSecret) this.assertSignature(request, dataId)

    if (!dataId) return null
    if (type === 'payment') return { kind: 'payment', id: dataId }
    if (type === 'subscription_authorized_payment' || type === 'authorized_payment') return { kind: 'authorized_payment', id: dataId }
    if (type === 'subscription_preapproval' || type === 'preapproval') return { kind: 'preapproval', id: dataId }
    return null
  }

  /**
   * Renovação automática: assinatura SEM plano associado, com a cobrança de N em N dias. O 1º pagamento
   * acontece quando a pessoa autoriza no link devolvido (cartão no ambiente do Mercado Pago).
   */
  async createRecurring (input: RecurringInput): Promise<CheckoutOutput> {
    if (!input.payerEmail) throw new Error('A renovação automática precisa do e-mail de quem assina.')
    // A assinatura não leva notification_url: os avisos vêm do webhook cadastrado no painel do Mercado Pago.
    console.log(`[mercadopago] renovação ${input.paymentId}: avisos pelo webhook do painel (referência ${encodeReference(input.env, input.paymentId)})`)
    const body = {
      reason: input.title,
      // Leva o ambiente: os avisos das cobranças seguintes chegam sem ele (ver payment-reference.ts).
      external_reference: encodeReference(input.env, input.paymentId),
      payer_email: input.payerEmail,
      back_url: `${this.config.frontendUrl}/assinatura/retorno`,
      auto_recurring: {
        frequency: input.frequencyDays,
        frequency_type: 'days',
        transaction_amount: input.amountCents / 100,
        currency_id: 'BRL',
      },
      status: 'pending',
    }
    const res = await this.fetchImpl(`${API}/preapproval`, {
      method: 'POST',
      headers: this.headers({ 'X-Idempotency-Key': input.paymentId }),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Mercado Pago recusou criar a renovação automática (HTTP ${res.status}).`)
    const json = (await res.json()) as { id?: string, init_point?: string, sandbox_init_point?: string }
    const checkoutUrl = this.config.sandbox ? (json.sandbox_init_point ?? json.init_point) : json.init_point
    if (!json.id || !checkoutUrl) throw new Error('Resposta do Mercado Pago sem link de autorização.')
    return { providerReference: json.id, checkoutUrl }
  }

  async getPreapproval (preapprovalId: string): Promise<ProviderPreapproval> {
    const res = await this.fetchImpl(`${API}/preapproval/${encodeURIComponent(preapprovalId)}`, { headers: this.headers() })
    if (!res.ok) throw new Error(`Mercado Pago não devolveu a assinatura ${preapprovalId} (HTTP ${res.status}).`)
    const p = (await res.json()) as { id: string, status?: string, external_reference?: string }
    return { id: String(p.id), status: mapMercadoPagoRecurringStatus(p.status), externalReference: p.external_reference ?? '' }
  }

  async getAuthorizedPayment (authorizedPaymentId: string): Promise<ProviderAuthorizedPayment> {
    const res = await this.fetchImpl(`${API}/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`, { headers: this.headers() })
    if (!res.ok) throw new Error(`Mercado Pago não devolveu a cobrança ${authorizedPaymentId} (HTTP ${res.status}).`)
    const p = (await res.json()) as { id: number | string, preapproval_id?: string, payment?: { id?: number | string } }
    return {
      id: String(p.id),
      preapprovalId: String(p.preapproval_id ?? ''),
      paymentId: p.payment?.id !== undefined && p.payment.id !== null ? String(p.payment.id) : null,
    }
  }

  async cancelRecurring (preapprovalId: string): Promise<void> {
    const res = await this.fetchImpl(`${API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ status: 'cancelled' }),
    })
    if (!res.ok) throw new Error(`Mercado Pago recusou cancelar a assinatura ${preapprovalId} (HTTP ${res.status}).`)
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
