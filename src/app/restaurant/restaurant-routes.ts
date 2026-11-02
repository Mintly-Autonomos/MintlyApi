import { FastifyInstance } from 'fastify'
import { RestaurantController } from './restaurant-controller'

export async function restaurantRoutes (fastify: FastifyInstance) {
  const controller = new RestaurantController()

  // GET /restaurants/me?month=AAAA-MM — restaurante + perfil tributário (MIN-23).
  fastify.get('/me', async (request: any, reply) => controller.me(request, reply))

  // POST /restaurants/me/first-access — conclui o onboarding: grava firstAccessAt (hora do servidor).
  // Sem corpo; repetir não muda a data; restaurante antigo (sem o campo) não é alterado.
  fastify.post('/me/first-access', async (request: any, reply) => controller.completeFirstAccess(request, reply))

  // PATCH /restaurants/me — body: { name?, taxRegime? }
  fastify.patch('/me', async (request: any, reply) => controller.updateMe(request, reply))
}
