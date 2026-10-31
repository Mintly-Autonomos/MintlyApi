import { FastifyReply, FastifyRequest } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { assertValidEnv } from '../environment/env-allowlist'
import { getPaymentProvider } from './get-payment-provider'
import { GiftSubscriptionUseCase } from './gift-use-case'
import { CancelRenewalUseCase, ConfirmAuthorizedPaymentUseCase, MockChargeNextUseCase, SyncPreapprovalUseCase } from './recurring-use-cases'
import { PaymentRepository } from './payment-repository'
import {
  ConfirmPaymentUseCase,
  CreateCheckoutUseCase,
  GetSubscriptionOverviewUseCase,
  MockDecideUseCase,
} from './subscription-use-cases'

export class SubscriptionController {
  constructor (
    private readonly overviewUseCase = new GetSubscriptionOverviewUseCase(),
    private readonly checkoutUseCase = new CreateCheckoutUseCase(),
    private readonly mockDecideUseCase = new MockDecideUseCase(),
    private readonly confirmUseCase: ConfirmPaymentUseCase = new ConfirmPaymentUseCase(),
    private readonly giftUseCase = new GiftSubscriptionUseCase(),
    private readonly authorizedPaymentUseCase = new ConfirmAuthorizedPaymentUseCase(confirmUseCase),
    private readonly syncPreapprovalUseCase = new SyncPreapprovalUseCase(),
    private readonly cancelRenewalUseCase = new CancelRenewalUseCase(),
    private readonly mockChargeNextUseCase = new MockChargeNextUseCase(new PaymentRepository(), confirmUseCase),
  ) {}

  /** GET /subscription */
  async overview (request: FastifyRequest, reply: FastifyReply) {
    const result = await this.overviewUseCase.execute(buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }

  /** POST /subscription/checkout — body: { months } */
  async checkout (request: FastifyRequest, reply: FastifyReply) {
    const ctx = buildRequestContext(request)
    const claims = (request as any).jwtClaims?.claims as Record<string, string[]> | undefined
    const result = await this.checkoutUseCase.execute((request.body ?? {}) as { months: unknown, tier?: unknown, autoRenew?: unknown }, ctx, claims?.email?.[0])
    return new ResponseBuilder().status(StatusCodes.CREATED).payload(result).send(reply)
  }

  /**
   * POST /admin/subscription-gift — headers: env, x-admin-key; body: { email }.
   * Rota PÚBLICA (sem JWT) protegida pela chave de administrador; ver GiftSubscriptionUseCase.
   */
  async gift (request: FastifyRequest, reply: FastifyReply) {
    const ctx = buildRequestContext(request.headers)
    await assertValidEnv(ctx.env)
    const result = await this.giftUseCase.execute(
      (request.body ?? {}) as { email: unknown },
      request.headers['x-admin-key'],
      ctx,
    )
    return new ResponseBuilder().status(StatusCodes.OK).payload({ granted: result.granted, endsAt: result.endsAt.toISOString() }).send(reply)
  }

  /** POST /subscription/cancel-renewal — cancela a renovação automática (o acesso vale até a data paga). */
  async cancelRenewal (request: FastifyRequest, reply: FastifyReply) {
    const result = await this.cancelRenewalUseCase.execute(buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }

  /** POST /subscription/mock/charge-next — só no simulador: faz de conta que cobrou o próximo ciclo. */
  async mockChargeNext (request: FastifyRequest, reply: FastifyReply) {
    const result = await this.mockChargeNextUseCase.execute(buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }

  /** POST /subscription/mock/decide — body: { paymentId, decision } (só no provedor simulado) */
  async mockDecide (request: FastifyRequest, reply: FastifyReply) {
    const result = await this.mockDecideUseCase.execute(
      (request.body ?? {}) as { paymentId: string, decision: unknown },
      buildRequestContext(request),
    )
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }

  /**
   * POST /webhooks/mercadopago?env=<ambiente> — rota PÚBLICA (o Mercado Pago não manda JWT).
   * A segurança está em (1) assinatura do aviso, quando o segredo está configurado, e principalmente
   * (2) o pagamento ser reconsultado no Mercado Pago com o nosso token antes de valer.
   * Responde 200 para avisos tratados ou ignorados (para o provedor não reenviar à toa); erro de
   * consulta ao provedor vira 500, e o Mercado Pago tenta de novo.
   */
  async mercadoPagoWebhook (request: FastifyRequest, reply: FastifyReply) {
    // Pagamento único: o ambiente vai na URL. Cobranças da renovação automática chegam no webhook do painel
    // do provedor, sem ele: aí o ambiente sai da referência que o provedor devolve na reconsulta.
    const queryEnv = String((request.query as Record<string, unknown>)?.env ?? '').trim()
    const env = queryEnv || undefined
    if (env) await assertValidEnv(env)

    const provider = getPaymentProvider()
    if (provider.name !== 'mercadopago' || !provider.parseWebhook) throw new NotFoundError('route', 'webhooks/mercadopago')

    const parsed = provider.parseWebhook({
      headers: request.headers,
      query: (request.query ?? {}) as Record<string, unknown>,
      body: request.body,
    })
    if (parsed?.kind === 'payment') {
      if (!env) await this.confirmUseCase.execute(parsed.id, undefined, provider)
      else await this.confirmUseCase.execute(parsed.id, env, provider)
    } else if (parsed?.kind === 'authorized_payment') {
      await this.authorizedPaymentUseCase.execute(parsed.id, env, provider)
    } else if (parsed?.kind === 'preapproval') {
      await this.syncPreapprovalUseCase.execute(parsed.id, env, provider)
    }

    return reply.status(StatusCodes.OK).send({ received: true })
  }
}
