import { FastifyInstance } from 'fastify'
import { ResultController } from './result-controller'

export async function resultRoutes (fastify: FastifyInstance) {
  const controller = new ResultController()

  // GET /reports/result?month=AAAA-MM — DRE do mês (fatia 4). Mês inválido ou futuro → 400.
  fastify.get('/result', async (request: any, reply) => controller.get(request, reply))
}
