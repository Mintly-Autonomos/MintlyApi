import { FastifyInstance } from 'fastify'
import { OverviewController } from './overview-controller'

export async function overviewRoutes (fastify: FastifyInstance) {
  const controller = new OverviewController()

  // GET /dashboard/overview?month=AAAA-MM — fatia 8. Mês inválido/futuro → 400.
  fastify.get('/overview', async (request: any, reply) => controller.get(request, reply))
}
