import type { PaymentProviderName, SubscriptionPlanMonths, SubscriptionTier } from 'mintly-lib'

/** Estado do pagamento já traduzido para o vocabulário do Mintly (cada provedor usa o seu). */
export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded'

export interface CheckoutInput {
  /** Id do pagamento no Mintly: volta do provedor como referência externa. */
  paymentId: string
  /** Ambiente (banco) do tenant: vai na URL do webhook, que não carrega o header `env`. */
  env: string
  title: string
  /** Tipo e duração comprados: vão junto na cobrança (metadados) para o pagamento "saber" qual plano é. */
  tier: SubscriptionTier
  months: SubscriptionPlanMonths
  /** Dias de acesso do plano (30, 90, 180 ou 360). */
  days: number
  amountCents: number
  payerEmail?: string
}

/** Cobrança de uma renovação automática: o mesmo que um pagamento único, mais de quantos em quantos dias cobrar. */
export interface RecurringInput extends CheckoutInput {
  frequencyDays: number
}

export type RecurringStatus = 'pending' | 'authorized' | 'paused' | 'cancelled'

/** A assinatura (renovação automática) como o provedor a conhece. */
export interface ProviderPreapproval {
  id: string
  status: RecurringStatus
  /** A referência que mandamos ao criar a assinatura (leva o ambiente: ver payment-reference.ts). */
  externalReference: string
}

/** Uma cobrança de uma renovação automática. `paymentId` fica vazio enquanto o pagamento não existe. */
export interface ProviderAuthorizedPayment {
  id: string
  preapprovalId: string
  paymentId: string | null
}

/** O que o aviso (webhook) diz ter mudado. O conteúdo do aviso nunca vale: só aponta o que reconsultar. */
export interface WebhookEvent {
  kind: 'payment' | 'authorized_payment' | 'preapproval'
  id: string
}

export interface CheckoutOutput {
  providerReference: string
  checkoutUrl: string
}

export interface ProviderPayment {
  id: string
  status: PaymentStatus
  amountCents: number
  /** O `paymentId` que mandamos ao criar a cobrança. */
  externalReference: string
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>
  query: Record<string, unknown>
  body: unknown
}

/**
 * Contrato com o provedor de pagamento. Trocar de provedor é trocar a implementação escolhida em
 * `get-payment-provider.ts` (variável PAYMENT_PROVIDER): o resto da assinatura não conhece o provedor.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName
  createCheckout (input: CheckoutInput): Promise<CheckoutOutput>
  /** Consulta o pagamento NO PROVEDOR. É a única fonte de verdade: o conteúdo do webhook não é confiável. */
  getPayment (providerPaymentId: string, env: string): Promise<ProviderPayment>
  /**
   * Valida e lê o aviso (webhook) do provedor. Devolve o id do pagamento a consultar, ou `null` quando o
   * aviso não é de pagamento (ex.: pedido do comerciante). Lança UnauthorizedError se a assinatura não bater.
   */
  parseWebhook? (request: WebhookRequest): WebhookEvent | null
  /** Renovação automática: cria a assinatura no provedor e devolve o link para a pessoa autorizar. */
  createRecurring? (input: RecurringInput): Promise<CheckoutOutput>
  getPreapproval? (preapprovalId: string, env: string): Promise<ProviderPreapproval>
  getAuthorizedPayment? (authorizedPaymentId: string, env: string): Promise<ProviderAuthorizedPayment>
  cancelRecurring? (preapprovalId: string, env: string): Promise<void>
}
