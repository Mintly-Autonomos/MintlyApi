import { FastifyInstance, FastifyRequest } from 'fastify'
import { Person } from 'mintly-lib'
import type { FindAllRequestDto, Headers } from 'mintly-lib'
import { PersonController } from './person-controller'

type PersonHeaders = Headers
type PersonBody = Omit<Person, 'id' | '_id'>
type PersonParams = { id: string }
type PersonListQuery = FindAllRequestDto<Person> & { isMultipleResponse?: 'true' | 'false' }

type PostPersonRequest = FastifyRequest<{ Body: PersonBody, Headers: PersonHeaders }>
type GetPersonListRequest = FastifyRequest<{ Querystring: PersonListQuery, Headers: PersonHeaders }>
type GetPersonByIdRequest = FastifyRequest<{ Params: PersonParams, Headers: PersonHeaders }>
type PatchPersonRequest = FastifyRequest<{ Params: PersonParams, Body: Partial<PersonBody>, Headers: PersonHeaders }>
type DeletePersonRequest = FastifyRequest<{ Params: PersonParams, Headers: PersonHeaders }>

export async function personRoutes (fastify: FastifyInstance) {
  const personController = new PersonController()

  fastify.post('/', (request: PostPersonRequest) => {
    return personController.insert(request.body as Person, request.headers)
  })

  fastify.get('/', (request: GetPersonListRequest) => {
    return request.query.isMultipleResponse === 'true'
      ? personController.find(request.query, request.headers)
      : personController.findAll(request.query, request.headers)
  })

  fastify.get('/:id', (request: GetPersonByIdRequest) => {
    return personController.findById(request.params.id, request.headers)
  })

  fastify.patch('/:id', (request: PatchPersonRequest) => {
    return personController.update(request.params.id, request.body as Partial<Person>, request.headers)
  })

  fastify.delete('/:id', async (request: DeletePersonRequest, reply) => {
    await personController.delete(request.params.id, request.headers)
    return reply.code(204).send()
  })
}
