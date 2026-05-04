import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Hook de isolamento de tenant para Fastify.
 *
 * ATENÇÃO: Em produção, o restauranteId DEVE ser lido do JWT decodificado (request.user.restauranteId)
 * após implementação da autenticação. NÃO use header em produção!
 *
 * Por enquanto, para desenvolvimento/testes, o restauranteId é lido do header x-restaurante-id.
 *
 * TODO: Substituir leitura do header por request.user.restauranteId após implementação do JWT.
 */
export async function tenantIsolationHook(request: FastifyRequest, reply: FastifyReply) {
  // TODO: Quando JWT estiver implementado, use: const restauranteId = request.user?.restauranteId
  const restauranteId = request.headers['x-restaurante-id'] as string | undefined

  // Coleções públicas (ex: market_prices) não exigem tenant
  const publicCollections = ['market_prices']
  const url = request.raw.url || ''
  const isPublic = publicCollections.some((col) => url.includes(col))
  if (isPublic) return

  if (!restauranteId) {
    reply.status(403).send({
      code: 'TENANT_REQUIRED',
      message: 'restaurante_id obrigatório para esta operação'
    })
    return
  }

  // Injeta restauranteId tipado no request (ver fastify.d.ts)
  request.restauranteId = restauranteId
}
