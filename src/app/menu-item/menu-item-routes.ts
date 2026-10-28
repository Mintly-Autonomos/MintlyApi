import { FastifyInstance } from 'fastify'
import { MenuItemRepository } from './menu-item-repository'
import { MenuItemController } from './menu-item-controller'

export async function menuItemRoutes (fastify: FastifyInstance) {
  const controller = new MenuItemController(new MenuItemRepository())

  fastify.post('/', async (request, reply) => {
    const response = await controller.insert(request.body as any, request)
    return reply.status(201).send(response)
  })

  fastify.get('/', async (request, reply) => {
    const response = await controller.findAll(request.query as any, request)
    return reply.status(200).send(response)
  })

  // Estática antes de "/:id" por clareza (o router já resolve estático primeiro).
  fastify.get('/price-alerts', async (request, reply) => controller.priceAlerts(request, reply))

  fastify.patch('/:id', async (request: any, reply) => {
    const response = await controller.update(request.params.id, request.body as any, request)
    return reply.status(200).send(response)
  })

  fastify.patch('/:id/price', async (request: any, reply) => controller.updatePrice(request, reply))
  fastify.post('/:id/price-review', async (request: any, reply) => controller.keepPrice(request, reply))
  fastify.patch('/:id/inactivate', async (request: any, reply) => controller.inactivate(request, reply))
  fastify.patch('/:id/reactivate', async (request: any, reply) => controller.reactivate(request, reply))

  // NOTA: DELETE e GET /:id não existem de propósito — só inativação, como categorias e contas.
}
