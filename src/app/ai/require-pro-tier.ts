import { FastifyRequest } from 'fastify'
import { buildRequestContext } from '../../core/context/build-request-context'
import { readSubscriptionRecord } from '../subscription/subscription-reader'
import { AiProOnlyError } from './ai-errors'

/**
 * preHandler das rotas /ai: só o plano Pro usa a IA (a IA gasta dinheiro por chamada e é o diferencial do Pro).
 * Roda DEPOIS do portão de assinatura do escopo protegido, que já barra quem não tem assinatura válida (402);
 * aqui só se confere o tipo do plano. Sem tipo gravado, a conta conta como Básico.
 */
export async function requireProTier (request: FastifyRequest): Promise<void> {
  const ctx = buildRequestContext(request)
  const { tier } = await readSubscriptionRecord(ctx.env, ctx.restaurantId)
  if (tier !== 'pro') throw new AiProOnlyError()
}
