import { FastifyInstance } from 'fastify'
import { AiController } from './ai-controller'

/**
 * IA do Mintly (Claude Haiku). Atrás do login e do portão de assinatura. Restaurante e usuário vêm do token e os
 * dados que a IA lê são montados no servidor: o corpo só diz a tela/mês ou o prato.
 */
export async function aiRoutes (fastify: FastifyInstance) {
  const controller = new AiController()

  fastify.get('/usage', { schema: { tags: ['ai'], summary: 'Chamadas à IA usadas e restantes hoje' } }, async (request: any, reply) => controller.usage(request, reply))

  fastify.post('/insights', { schema: { tags: ['ai'], summary: 'Reescreve os textos dos insights da tela para o restaurante' } }, async (request: any, reply) => controller.createInsights(request, reply))

  fastify.post('/price-suggestion', { schema: { tags: ['ai'], summary: 'Sugere o aumento ideal do preço de um prato' } }, async (request: any, reply) => controller.createPriceSuggestion(request, reply))
}
