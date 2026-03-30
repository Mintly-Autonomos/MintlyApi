import { FastifyInstance } from 'fastify'
import { PersonController } from './person-controller'

export async function personRoutes (fastify: FastifyInstance) {
  const personController = new PersonController()

  fastify.post('/', (request: any) => {
    return personController.insert(request.body, request.headers)
  })

  fastify.get('/', (request: any) => {
    return request.query.isMultipleResponse
      ? personController.find(request.query || {}, request.headers)
      : personController.findAll(request.query || {}, request.headers)
  })

  fastify.get('/:id', (request: any) => {
    return personController.findById(request.params.id, request.headers)
  })

  fastify.delete('/:id', (request: any) => {
    return personController.delete(request.params.id, request.headers)
  })

  // fastify.patch("/:id", (request: any) => {
  //   return personController.update(request.params.id, request.body, request.headers)
  // })
}
