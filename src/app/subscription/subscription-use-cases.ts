import { ObjectId } from 'mongodb'
import {
  DEFAULT_SUBSCRIPTION_TIER,
  SUBSCRIPTION_PLAN_DAYS,
  SUBSCRIPTION_TIER_LABEL,
  addDays,
  applySubscriptionPurchase,
  isSubscriptionPlan,
  isSubscriptionTier,
  subscriptionPlanPrice,
  subscriptionTiers,
} from 'mintly-lib'
import type { SubscriptionCheckoutResponse, SubscriptionOverview } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { BaseError } from '../../core/errors/core/base-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { ValidationError } from '../../core/errors/core/validation-error'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import type { PaymentProvider, ProviderPayment } from './payment-provider'
import { getPaymentProvider } from './get-payment-provider'
import { PaymentRepository } from './payment-repository'
import type { PaymentRecord } from './payment-repository'
import { readRecurring, readSubscriptionState } from './subscription-reader'
import { decodeReference } from './payment-reference'

import { assertValidEnv } from '../environment/env-allowlist'

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
    const recurring = await readRecurring(ctx.env, ctx.restaurantId)
    return { ...state, tiers: subscriptionTiers(), provider: this.provider().name, recurring }
  }
}

/** POST /subscription/checkout — cria a cobrança do plano. O valor é SEMPRE recalculado aqui. */
export class CreateCheckoutUseCase {
  constructor (
    private readonly payments: PaymentRepository = new PaymentRepository(),
    private readonly provider: () => PaymentProvider = getPaymentProvider,
  ) {}

  async execute (input: { months: unknown, tier?: unknown, autoRenew?: unknown }, ctx: RequestContext, payerEmail?: string): Promise<SubscriptionCheckoutResponse> {
    if (!isSubscriptionPlan(input?.months)) {
      throw new ValidationError('Plano inválido: escolha 1, 3, 6 ou 12 meses.')
    }
    if (input.tier !== undefined && !isSubscriptionTier(input.tier)) {
      throw new ValidationError('Tipo de assinatura inválido: escolha basic ou pro.')
    }
    if (input.autoRenew !== undefined && typeof input.autoRenew !== 'boolean') {
      throw new ValidationError('autoRenew deve ser verdadeiro ou falso.')
    }
    if (!ctx.restaurantId) throw new NotFoundError('restaurants', ctx.restaurantId)

    const autoRenew = input.autoRenew === true
    const tier = input.tier ?? DEFAULT_SUBSCRIPTION_TIER
    const price = subscriptionPlanPrice(input.months, tier)
    const provider = this.provider()
    if (autoRenew && !provider.createRecurring) {
      throw new ValidationError('A renovação automática não está disponível neste ambiente.')
    }
    const payment = await this.payments.create(ctx.env, {
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      provider: provider.name,
      tier,
      months: price.months,
      amountCents: price.totalCents,
      ...(autoRenew ? { kind: 'recurring' as const } : {}),
    })

    try {
      const checkoutInput = {
        paymentId: String(payment._id),
        env: ctx.env,
        title: `Assinatura Mintly ${SUBSCRIPTION_TIER_LABEL[tier]} — ${price.months} ${price.months === 1 ? 'mês' : 'meses'}${autoRenew ? ' (renovação automática)' : ''}`,
        tier,
        months: price.months,
        days: price.days,
        amountCents: price.totalCents,
        payerEmail,
      }
      let checkout
      if (autoRenew) {
        checkout = await provider.createRecurring!({ ...checkoutInput, frequencyDays: price.days })
        await this.payments.setPreapproval(ctx.env, payment._id, checkout.providerReference)
      } else {
        checkout = await provider.createCheckout(checkoutInput)
      }
      return {
        paymentId: String(payment._id),
        checkoutUrl: checkout.checkoutUrl,
        provider: provider.name,
        tier,
        months: price.months,
        totalCents: price.totalCents,
        autoRenew,
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

  /** `env` vazio: o ambiente sai da referência que o provedor devolve (avisos da renovação automática). */
  async execute (providerPaymentId: string, env: string | undefined, provider: PaymentProvider, now: Date = new Date()): Promise<ConfirmResult> {
    const remote = await provider.getPayment(providerPaymentId, env ?? '')
    return this.process(remote, env, provider, now)
  }

  /**
   * Trata um pagamento JÁ consultado no provedor. `context` vem da renovação automática: a assinatura
   * (e o registro do plano) em que a cobrança foi feita, que não depende de o pagamento repetir a referência.
   */
  async process (
    remote: ProviderPayment,
    env: string | undefined,
    provider: PaymentProvider,
    now: Date = new Date(),
    context?: { intentId: string, preapprovalId: string },
  ): Promise<ConfirmResult> {
    const reference = decodeReference(remote.externalReference)
    const realEnv = env ?? reference.env
    if (!realEnv) return { result: 'unknown_payment' }
    await assertValidEnv(realEnv)
    env = realEnv

    // Esta cobrança já tem registro (aviso repetido, ou estorno depois de aprovada)? Senão, pelo registro do plano.
    const payment = (await this.payments.findByProviderPaymentId(env, remote.id)) ??
      await this.payments.findById(env, context?.intentId ?? reference.id)
    if (!payment || payment.provider !== provider.name) return { result: 'unknown_payment' }
    if (context && payment.preapprovalId !== context.preapprovalId) return { result: 'unknown_payment' }

    // Renovação automática: o registro do plano já foi aplicado por OUTRO pagamento = é uma cobrança de um
    // ciclo seguinte. Ganha registro próprio (único por pagamento do provedor) e soma os dias do plano.
    if (payment.kind === 'recurring' && payment.appliedAt && payment.providerPaymentId !== remote.id) {
      if (remote.amountCents !== payment.amountCents) {
        console.error(`Cobrança ${remote.id}: valor do provedor (${remote.amountCents}) difere do cobrado (${payment.amountCents}). Nada foi concedido.`)
        return { result: 'amount_mismatch' }
      }
      if (remote.status !== 'approved') return { result: 'not_approved', status: remote.status }
      const charge = await this.payments.createCharge(env, payment, remote.id)
      if (!charge) return { result: 'already_applied' }
      return this.apply(env, charge, remote.id, provider, now)
    }

    // Já somado: só um estorno/chargeback DESTE pagamento mexe no que foi concedido (desconta os mesmos dias).
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

    return this.apply(env, payment, remote.id, provider, now)
  }

  /** Soma os dias do plano à assinatura, numa transação, UMA vez por pagamento. */
  private async apply (env: string, payment: PaymentRecord, remoteId: string, provider: PaymentProvider, now: Date): Promise<ConfirmResult> {
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    let previousPreapprovalId: string | undefined
    try {
      let outcome: ConfirmResult = { result: 'already_applied' }
      await session.withTransaction(async () => {
        const claimed = await this.payments.claimApplication(env, payment._id, remoteId, session)
        if (!claimed) {
          outcome = { result: 'already_applied' }
          return
        }
        const restaurants = connection.getDatabase(env).collection('restaurants')
        const _id = new ObjectId(payment.restaurantId)
        const current = await restaurants.findOne({ _id }, { projection: { 'subscription.endsAt': 1, 'subscription.tier': 1, 'subscription.recurring': 1 }, session })
        if (!current) throw new NotFoundError('restaurants', payment.restaurantId)

        const raw = current.subscription?.endsAt
        const tier = payment.tier ?? DEFAULT_SUBSCRIPTION_TIER
        // Mesmo tipo e ainda ativa: soma ao que sobrou. Tipo diferente (up ou downgrade) ou vencida: conta de hoje.
        const purchase = applySubscriptionPurchase(
          { endsAt: raw ? new Date(raw) : null, tier: current.subscription?.tier },
          { tier, months: payment.months },
          now,
        )
        const endsAt = purchase.endsAt
        // O que este pagamento acrescentou, em tempo exato: o estorno desconta isso (mês tem tamanhos diferentes).
        await this.payments.setGrantedMs(env, payment._id, endsAt.getTime() - purchase.startedAt.getTime(), session)
        // Recomeçou a contagem: o tempo dos pagamentos anteriores não existe mais na assinatura.
        if (purchase.startedAt.getTime() === now.getTime()) {
          await this.payments.supersedePrevious(env, payment.restaurantId, payment._id, session)
        }

        await restaurants.updateOne(
          { _id },
          {
            $set: {
              'subscription.endsAt': endsAt,
              'subscription.tier': tier,
              'subscription.plan': payment.months,
              'subscription.lastPaymentId': String(payment._id),
              'subscription.updatedAt': now,
              // Cobrança de renovação automática aprovada: a renovação passa a valer para este plano.
              ...(payment.kind === 'recurring' && payment.preapprovalId
                ? {
                  'subscription.recurring': {
                    preapprovalId: payment.preapprovalId,
                    status: 'authorized',
                    tier,
                    months: payment.months,
                    provider: payment.provider,
                    startedAt: current.subscription?.recurring?.preapprovalId === payment.preapprovalId
                      ? (current.subscription.recurring.startedAt ?? now)
                      : now,
                    updatedAt: now,
                  },
                }
                : {}),
            },
          },
          { session },
        )
        // Trocou de plano com uma renovação nova: a antiga, se ainda ativa, precisa parar de cobrar.
        const before = current.subscription?.recurring
        if (payment.kind === 'recurring' && before?.preapprovalId && before.preapprovalId !== payment.preapprovalId && before.status !== 'cancelled') {
          previousPreapprovalId = before.preapprovalId
        }
        outcome = { result: 'applied', endsAt }
      })
      if (previousPreapprovalId && provider.cancelRecurring) {
        await provider.cancelRecurring(previousPreapprovalId, env).catch((error: Error) => {
          console.error(`Não foi possível cancelar a renovação anterior (${previousPreapprovalId}):`, error.message)
        })
      }
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
        // Se uma compra posterior recomeçou a contagem (troca de tipo ou vencida), o tempo deste pagamento
        // já não está na assinatura: não há o que tirar.
        if (payment.supersededAt) {
          outcome = { result: 'revoked', endsAt: atual }
          return
        }
        // Pagamentos antigos, sem o tempo guardado, caem nos dias do plano.
        const endsAt = payment.grantedMs === undefined
          ? addDays(atual, -SUBSCRIPTION_PLAN_DAYS[payment.months])
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
