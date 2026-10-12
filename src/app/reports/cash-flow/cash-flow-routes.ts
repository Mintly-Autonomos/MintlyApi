import { FastifyInstance } from 'fastify'
import { CashFlowController } from './cash-flow-controller'

export async function cashFlowRoutes (fastify: FastifyInstance) {
  const controller = new CashFlowController()

  // GET /reports/cash-flow?horizon=30 — horizonte de 1 a 365 dias (padrão 30).
  // Fora disso (ou não inteiro) o schema devolve 400 antes de chegar no controller.
  fastify.get('/cash-flow', {
    schema: {
      tags: ['reports'],
      summary: 'Fluxo de Caixa (MIN-94)',
      querystring: {
        type: 'object',
        properties: {
          horizon: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
  }, async (request: any, reply) => controller.get(request, reply))
}
