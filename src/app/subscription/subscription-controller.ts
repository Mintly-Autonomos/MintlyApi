import { FastifyReply, FastifyRequest } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { MissingEnvError } from '../../core/errors/core/missing-env-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { assertValidEnv } from '../environment/env-allowlist'
import { getPaymentProvider } from './get-payment-provider'
import { GiftSubscriptionUseCase } from './gift-use-case'
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
    private readonly confirmUseCase = new ConfirmPaymentUseCase(),
    private readonly giftUseCase = new GiftSubscriptionUseCase(),
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
    const result = await this.checkoutUseCase.execute((request.body ?? {}) as { months: unknown, tier?: unknown }, ctx, claims?.email?.[0])
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
    const env = String((request.query as Record<string, unknown>)?.env ?? '').trim()
    if (!env) throw new MissingEnvError()
    await assertValidEnv(env)

    const provider = getPaymentProvider()
    if (provider.name !== 'mercadopago' || !provider.parseWebhook) throw new NotFoundError('route', 'webhooks/mercadopago')

    const parsed = provider.parseWebhook({
      headers: request.headers,
      query: (request.query ?? {}) as Record<string, unknown>,
      body: request.body,
    })
    if (parsed) await this.confirmUseCase.execute(parsed.providerPaymentId, env, provider)

    return reply.status(StatusCodes.OK).send({ received: true })
  }
}
