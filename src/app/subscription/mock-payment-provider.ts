import type { CheckoutInput, CheckoutOutput, PaymentProvider, ProviderPayment } from './payment-provider'
import { PaymentRepository } from './payment-repository'
import { NotFoundError } from '../../core/errors/core/not-found-error'

/**
 * Provedor SIMULADO, para ambientes sem conexão real com pagamento (ex.: a Vercel de teste).
 * A cobrança aponta para uma tela do próprio app (`/assinatura/simulador`) onde a pessoa aprova ou
 * recusa; a decisão fica no documento do pagamento e `getPayment` a devolve, exatamente como o
 * provedor real devolveria. Do aviso para frente o caminho é o MESMO do Mercado Pago.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const

  constructor (
    private readonly payments: PaymentRepository = new PaymentRepository(),
    private readonly frontendUrl: string = process.env.FRONTEND_URL ?? 'http://localhost:4200',
  ) {}

  async createCheckout (input: CheckoutInput): Promise<CheckoutOutput> {
    return {
      providerReference: input.paymentId,
      checkoutUrl: `${this.frontendUrl.replace(/\/$/, '')}/assinatura/simulador?pagamento=${encodeURIComponent(input.paymentId)}`,
    }
  }

  async getPayment (providerPaymentId: string, env: string): Promise<ProviderPayment> {
    const record = await this.payments.findById(env, providerPaymentId)
    if (!record) throw new NotFoundError('payments', providerPaymentId)
    return {
      id: providerPaymentId,
      status: record.mockDecision ?? 'pending',
      amountCents: record.amountCents,
      externalReference: String(record._id),
    }
  }
}
