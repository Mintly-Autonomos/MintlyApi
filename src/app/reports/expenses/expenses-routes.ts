import { FastifyInstance } from 'fastify'
import { ExpensesController } from './expenses-controller'

export async function expensesRoutes (fastify: FastifyInstance) {
  const controller = new ExpensesController()

  // GET /reports/expenses?month=AAAA-MM&channel=dineIn|delivery — fatia 6. Mês futuro/inválido ou canal inválido → 400.
  fastify.get('/expenses', async (request: any, reply) => controller.get(request, reply))
}
