import { FastifyRequest } from 'fastify'
import { buildRequestContext } from '../context/build-request-context'
import { SubscriptionRequiredError } from '../errors/auth/subscription-required-error'
import { readSubscriptionState } from '../../app/subscription/subscription-reader'

/**
 * preHandler que só deixa passar quem tem assinatura válida (agora < data limite). Roda DEPOIS do
 * verifyJwt, que preenche o `restaurantId` do contexto. Sem assinatura (nunca assinou ou vencida), responde
 * 402 e o front leva a pessoa à tela de assinatura. As rotas de /subscription ficam fora deste portão.
 */
export async function requireActiveSubscription (request: FastifyRequest): Promise<void> {
  const ctx = buildRequestContext(request)
  const state = await readSubscriptionState(ctx.env, ctx.restaurantId)
  if (state.status !== 'active') throw new SubscriptionRequiredError()
}
