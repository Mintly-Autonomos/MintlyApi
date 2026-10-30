import { ObjectId } from 'mongodb'
import {
  addMonths,
  extendSubscription,
  isSubscriptionPlan,
  subscriptionPlanPrice,
  subscriptionPlans,
} from 'mintly-lib'
import type { SubscriptionCheckoutResponse, SubscriptionOverview } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { BaseError } from '../../core/errors/core/base-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { ValidationError } from '../../core/errors/core/validation-error'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import type { PaymentProvider } from './payment-provider'
import { getPaymentProvider } from './get-payment-provider'
import { PaymentRepository } from './payment-repository'
import type { PaymentRecord } from './payment-repository'
import { readSubscriptionState } from './subscription-reader'

/** 502: o provedor de pagamento não respondeu como esperado. A pessoa pode tentar de novo. */
export class PaymentProviderError extends BaseError {
  constructor (message = 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes.') {
    super(message, message, 'PAYMENT-0001', 502)
  }
}

export type ConfirmResult =
  | { result: 'applied', endsAt: Date }
  | { result: 'already_applied' }
  | { result: 'revoked', endsAt: Date }
  | { result: 'unknown_payment' }
  | { result: 'amount_mismatch' }
  | { result: 'not_approved', status: string }

/** GET /subscription — estado + planos + provedor, para montar a tela de assinatura. */
export class GetSubscriptionOverviewUseCase {
  constructor (private readonly provider: () => PaymentProvider = getPaymentProvider) {}

  async execute (ctx: RequestContext): Promise<SubscriptionOverview> {
    const state = await readSubscriptionState(ctx.env, ctx.restaurantId)
    return { ...state, plans: subscriptionPlans(), provider: this.provider().name }
  }
}

/** POST /subscription/checkout — cria a cobrança do plano. O valor é SEMPRE recalculado aqui. */
export class CreateCheckoutUseCase {
  constructor (
    private readonly payments: PaymentRepository = new PaymentRepository(),
    private readonly provider: () => PaymentProvider = getPaymentProvider,
  ) {}

  async execute (input: { months: unknown }, ctx: RequestContext, payerEmail?: string): Promise<SubscriptionCheckoutResponse> {
    if (!isSubscriptionPlan(input?.months)) {
      throw new ValidationError('Plano inválido: escolha 1, 3, 6 ou 12 meses.')
    }
    if (!ctx.restaurantId) throw new NotFoundError('restaurants', ctx.restaurantId)

    const price = subscriptionPlanPrice(input.months)
    const provider = this.provider()
    const payment = await this.payments.create(ctx.env, {
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      provider: provider.name,
      months: price.months,
      amountCents: price.totalCents,
    })

    try {
      const checkout = await provider.createCheckout({
        paymentId: String(payment._id),
        env: ctx.env,
        title: `Assinatura Mintly — ${price.months} ${price.months === 1 ? 'mês' : 'meses'}`,
        amountCents: price.totalCents,
        payerEmail,
      })
      return {
        paymentId: String(payment._id),
        checkoutUrl: checkout.checkoutUrl,
        provider: provider.name,
        months: price.months,
        totalCents: price.totalCents,
      }
    } catch (error) {
      await this.payments.setStatus(ctx.env, payment._id, 'cancelled').catch(() => null)
      console.error('Falha ao criar a cobrança no provedor:', (error as Error).message)
      throw new PaymentProviderError()
    }
  }
}

/**
 * Chamado quando o provedor avisa (webhook) ou, no simulador, quando a pessoa decide. Nunca confia no
 * conteúdo do aviso: consulta o pagamento NO PROVEDOR, confere o valor com o que cobramos e só então soma
 * os meses à assinatura. Idempotente: o mesmo pagamento só é somado UMA vez, mesmo com avisos repetidos
 * ou simultâneos. Estorno/chargeback de um pagamento já somado desconta os MESMOS meses (também uma vez só).
 */
export class ConfirmPaymentUseCase {
  constructor (private readonly payments: PaymentRepository = new PaymentRepository()) {}

  async execute (providerPaymentId: string, env: string, provider: PaymentProvider, now: Date = new Date()): Promise<ConfirmResult> {
    const remote = await provider.getPayment(providerPaymentId, env)

    const payment = await this.payments.findById(env, remote.externalReference)
    if (!payment || payment.provider !== provider.name) return { result: 'unknown_payment' }

    // Já somado: só um estorno/chargeback DESTE pagamento mexe no que foi concedido (desconta os mesmos meses).
    if (payment.appliedAt) {
      if (remote.status === 'refunded' && !payment.revokedAt && remote.id === payment.providerPaymentId) {
        return this.revoke(payment, remote.id, env, now)
      }
      return { result: 'already_applied' }
    }

    if (remote.amountCents !== payment.amountCents) {
      console.error(`Pagamento ${payment._id}: valor do provedor (${remote.amountCents}) difere do cobrado (${payment.amountCents}). Nada foi concedido.`)
      return { result: 'amount_mismatch' }
    }

    if (remote.status !== 'approved') {
      await this.payments.setStatus(env, payment._id, remote.status, { providerPaymentId: remote.id })
      return { result: 'not_approved', status: remote.status }
    }

    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    try {
      let outcome: ConfirmResult = { result: 'already_applied' }
      await session.withTransaction(async () => {
        const claimed = await this.payments.claimApplication(env, payment._id, remote.id, session)
        if (!claimed) {
          outcome = { result: 'already_applied' }
          return
        }
        const restaurants = connection.getDatabase(env).collection('restaurants')
        const _id = new ObjectId(payment.restaurantId)
        const current = await restaurants.findOne({ _id }, { projection: { 'subscription.endsAt': 1 }, session })
        if (!current) throw new NotFoundError('restaurants', payment.restaurantId)

        const raw = current.subscription?.endsAt
        const currentEndsAt = raw ? new Date(raw) : null
        const endsAt = extendSubscription(currentEndsAt, payment.months, now)
        // O que este pagamento acrescentou, em tempo exato: o estorno desconta isso (mês tem tamanhos diferentes).
        const base = currentEndsAt && currentEndsAt.getTime() > now.getTime() ? currentEndsAt : now
        await this.payments.setGrantedMs(env, payment._id, endsAt.getTime() - base.getTime(), session)

        await restaurants.updateOne(
          { _id },
          {
            $set: {
              'subscription.endsAt': endsAt,
              'subscription.plan': payment.months,
              'subscription.lastPaymentId': String(payment._id),
              'subscription.updatedAt': now,
            },
          },
          { session },
        )
        outcome = { result: 'applied', endsAt }
      })
      return outcome
    } finally {
      await session.endSession()
    }
  }

  /**
   * Estorno ou chargeback de um pagamento que já tinha liberado o acesso: tira de `endsAt` os meses que
   * ele deu. Se sobrou assinatura de outros pagamentos, ela continua; se o resultado fica no passado, a
   * conta cai em "sem assinatura" (402) na hora. Estorno parcial não passa por aqui (o status segue "aprovado").
   */
  private async revoke (payment: PaymentRecord, providerPaymentId: string, env: string, now: Date): Promise<ConfirmResult> {
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    try {
      let outcome: ConfirmResult = { result: 'already_applied' }
      await session.withTransaction(async () => {
        const claimed = await this.payments.claimRevocation(env, payment._id, providerPaymentId, session)
        if (!claimed) {
          outcome = { result: 'already_applied' }
          return
        }
        const restaurants = connection.getDatabase(env).collection('restaurants')
        const _id = new ObjectId(payment.restaurantId)
        const current = await restaurants.findOne({ _id }, { projection: { 'subscription.endsAt': 1 }, session })
        if (!current) throw new NotFoundError('restaurants', payment.restaurantId)

        const raw = current.subscription?.endsAt
        const atual = raw ? new Date(raw) : now
        // Pagamentos antigos, sem o tempo guardado, caem no cálculo por meses.
        const endsAt = payment.grantedMs === undefined
          ? addMonths(atual, -payment.months)
          : new Date(atual.getTime() - payment.grantedMs)
        await restaurants.updateOne(
          { _id },
          { $set: { 'subscription.endsAt': endsAt, 'subscription.updatedAt': now } },
          { session },
        )
        outcome = { result: 'revoked', endsAt }
      })
      return outcome
    } finally {
      await session.endSession()
    }
  }
}

/** POST /subscription/mock/decide — SÓ com o provedor simulado: a pessoa aprova ou recusa o pagamento de teste. */
export class MockDecideUseCase {
  constructor (
    private readonly payments: PaymentRepository = new PaymentRepository(),
    private readonly confirm: ConfirmPaymentUseCase = new ConfirmPaymentUseCase(),
    private readonly provider: () => PaymentProvider = getPaymentProvider,
  ) {}

  async execute (input: { paymentId: string, decision: unknown }, ctx: RequestContext): Promise<{ status: string }> {
    const provider = this.provider()
    // Em produção real este caminho NÃO existe: fingir que a rota não está lá.
    if (provider.name !== 'mock') throw new NotFoundError('route', 'mock/decide')
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new ValidationError('decision deve ser "approved" ou "rejected".')
    }

    const payment = await this.payments.findById(ctx.env, input.paymentId)
    if (!payment || payment.restaurantId !== ctx.restaurantId) throw new NotFoundError('payments', input.paymentId)
    if (payment.appliedAt) throw new ConflictError('Este pagamento já foi concluído.')

    await this.payments.setMockDecision(ctx.env, payment._id, input.decision)
    await this.confirm.execute(String(payment._id), ctx.env, provider)

    const after = await this.payments.findById(ctx.env, input.paymentId)
    return { status: after?.status ?? 'pending' }
  }
}
