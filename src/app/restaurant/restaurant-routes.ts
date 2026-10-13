import { FastifyInstance } from 'fastify'
import { RestaurantController } from './restaurant-controller'

export async function restaurantRoutes (fastify: FastifyInstance) {
  const controller = new RestaurantController()

  // GET /restaurants/me?month=AAAA-MM — restaurante + perfil tributário (MIN-23).
  fastify.get('/me', async (request: any, reply) => controller.me(request, reply))

  // PATCH /restaurants/me — body: { name?, taxRegime? }
  fastify.patch('/me', async (request: any, reply) => controller.updateMe(request, reply))
}
