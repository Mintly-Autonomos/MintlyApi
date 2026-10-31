import { ObjectId } from 'mongodb'
import { DEFAULT_SUBSCRIPTION_TIER, subscriptionPlanPrice } from 'mintly-lib'
import type { SubscriptionCancelRenewalResponse } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { assertValidEnv } from '../environment/env-allowlist'
import type { PaymentProvider } from './payment-provider'
import { getPaymentProvider } from './get-payment-provider'
import { PaymentRepository } from './payment-repository'
import { decodeReference } from './payment-reference'
import { PaymentProviderError } from './subscription-use-cases'
import type { ConfirmPaymentUseCase, ConfirmResult } from './subscription-use-cases'

/**
 * Aviso de uma COBRANÇA da renovação automática (`subscription_authorized_payment`). Nunca confia no aviso:
 * reconsulta a cobrança, a assinatura e o pagamento no provedor, confere que a assinatura é a do plano que
 * registramos, e entrega ao mesmo caminho dos pagamentos únicos (valor conferido, uma vez só por pagamento).
 */
export class ConfirmAuthorizedPaymentUseCase {
  constructor (private readonly confirm: ConfirmPaymentUseCase) {}

  async execute (authorizedPaymentId: string, env: string | undefined, provider: PaymentProvider, now: Date = new Date()): Promise<ConfirmResult> {
    if (!provider.getAuthorizedPayment || !provider.getPreapproval) return { result: 'unknown_payment' }
    const authorized = await provider.getAuthorizedPayment(authorizedPaymentId, env ?? '')
    // Cobrança ainda sem pagamento (agendada ou em nova tentativa): o provedor avisa de novo quando houver.
    if (!authorized.paymentId) return { result: 'not_approved', status: 'pending' }

    const preapproval = await provider.getPreapproval(authorized.preapprovalId, env ?? '')
    const reference = decodeReference(preapproval.externalReference)
    const realEnv = env ?? reference.env
    if (!realEnv || !reference.id) return { result: 'unknown_payment' }
    await assertValidEnv(realEnv)

    const remote = await provider.getPayment(authorized.paymentId, realEnv)
    return this.confirm.process(remote, realEnv, provider, now, { intentId: reference.id, preapprovalId: preapproval.id })
  }
}

/** Aviso de mudança da assinatura no provedor (`subscription_preapproval`): autorizada, pausada ou cancelada. */
export class SyncPreapprovalUseCase {
  async execute (preapprovalId: string, env: string | undefined, provider: PaymentProvider, now: Date = new Date()): Promise<{ result: 'synced' | 'ignored' }> {
    if (!provider.getPreapproval) return { result: 'ignored' }
    const preapproval = await provider.getPreapproval(preapprovalId, env ?? '')
    const realEnv = env ?? decodeReference(preapproval.externalReference).env
    if (!realEnv) return { result: 'ignored' }
    await assertValidEnv(realEnv)

    // Só atualiza a renovação que já está registrada (a 1ª cobrança aprovada é que a registra).
    const res = await MongoDBConnection.getInstance()
      .getDatabase(realEnv)
      .collection('restaurants')
      .updateOne(
        { 'subscription.recurring.preapprovalId': preapproval.id },
        { $set: { 'subscription.recurring.status': preapproval.status, 'subscription.recurring.updatedAt': now } },
      )
    return { result: res.matchedCount > 0 ? 'synced' : 'ignored' }
  }
}

/**
 * POST /subscription/cancel-renewal — a pessoa cancela a renovação automática. Para de cobrar no
 * provedor; o acesso continua até a data que já foi paga.
 */
export class CancelRenewalUseCase {
  constructor (private readonly provider: () => PaymentProvider = getPaymentProvider) {}

  async execute (ctx: RequestContext, now: Date = new Date()): Promise<SubscriptionCancelRenewalResponse> {
    if (!ctx.restaurantId || !ObjectId.isValid(ctx.restaurantId)) throw new NotFoundError('restaurants', ctx.restaurantId)
    const restaurants = MongoDBConnection.getInstance().getDatabase(ctx.env).collection('restaurants')
    const _id = new ObjectId(ctx.restaurantId)
    const doc = await restaurants.findOne({ _id }, { projection: { 'subscription.recurring': 1 } })
    const recurring = doc?.subscription?.recurring
    if (!recurring?.preapprovalId) throw new NotFoundError('subscription renewal', ctx.restaurantId)
    if (recurring.status === 'cancelled') return { status: 'cancelled' }

    const provider = this.provider()
    if (!provider.cancelRecurring) throw new ConflictError('Este ambiente não tem renovação automática.')
    try {
      await provider.cancelRecurring(recurring.preapprovalId, ctx.env)
    } catch (error) {
      console.error('Falha ao cancelar a renovação no provedor:', (error as Error).message)
      throw new PaymentProviderError('Não foi possível cancelar a renovação agora. Tente novamente em instantes.')
    }
    await restaurants.updateOne(
      { _id },
      { $set: { 'subscription.recurring.status': 'cancelled', 'subscription.recurring.cancelledAt': now, 'subscription.recurring.updatedAt': now } },
    )
    return { status: 'cancelled' }
  }
}

/** POST /subscription/mock/charge-next — SÓ no simulador: faz de conta que o provedor cobrou o próximo ciclo. */
export class MockChargeNextUseCase {
  constructor (
    private readonly payments: PaymentRepository,
    private readonly confirm: ConfirmPaymentUseCase,
    private readonly provider: () => PaymentProvider = getPaymentProvider,
  ) {}

  async execute (ctx: RequestContext): Promise<{ status: string }> {
    const provider = this.provider()
    if (provider.name !== 'mock') throw new NotFoundError('route', 'mock/charge-next')
    if (!ctx.restaurantId || !ObjectId.isValid(ctx.restaurantId)) throw new NotFoundError('restaurants', ctx.restaurantId)

    const doc = await MongoDBConnection.getInstance()
      .getDatabase(ctx.env)
      .collection('restaurants')
      .findOne({ _id: new ObjectId(ctx.restaurantId) }, { projection: { 'subscription.recurring': 1 } })
    const recurring = doc?.subscription?.recurring
    if (recurring?.status !== 'authorized') throw new ConflictError('Não há renovação automática ativa para cobrar.')

    const price = subscriptionPlanPrice(recurring.months, recurring.tier ?? DEFAULT_SUBSCRIPTION_TIER)
    const charge = await this.payments.create(ctx.env, {
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      provider: 'mock',
      tier: recurring.tier,
      months: recurring.months,
      amountCents: price.totalCents,
      kind: 'recurring',
      preapprovalId: recurring.preapprovalId,
    })
    await this.payments.setMockDecision(ctx.env, charge._id, 'approved')
    await this.confirm.execute(String(charge._id), ctx.env, provider)
    const after = await this.payments.findById(ctx.env, String(charge._id))
    return { status: after?.status ?? 'pending' }
  }
}
