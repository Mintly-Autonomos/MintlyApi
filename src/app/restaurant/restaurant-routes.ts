import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { buildRequestContext } from '../../core/context/build-request-context'
import { RestaurantController } from './restaurant-controller'
import { CreateMemberUseCase, ListMembersQuery, UpdateMemberUseCase } from './members/member.use-cases'

const str = { type: 'string' as const }

export async function restaurantRoutes (fastify: FastifyInstance) {
  const controller = new RestaurantController()
  const listMembers = new ListMembersQuery()
  const createMember = new CreateMemberUseCase()
  const updateMember = new UpdateMemberUseCase()

  // GET /restaurants/me?month=AAAA-MM — restaurante + perfil tributário (MIN-23).
  fastify.get('/me', async (request: any, reply) => controller.me(request, reply))

  // POST /restaurants/me/first-access — conclui o onboarding: grava firstAccessAt (hora do servidor).
  // Sem corpo; repetir não muda a data; restaurante antigo (sem o campo) não é alterado.
  fastify.post('/me/first-access', async (request: any, reply) => controller.completeFirstAccess(request, reply))

  // PATCH /restaurants/me — body: { name?, taxRegime? }. Só o dono.
  fastify.patch('/me', async (request: any, reply) => controller.updateMe(request, reply))

  // Funcionários (logins com papel `member` do restaurante). Só o dono.
  fastify.get('/me/members', {
    schema: { tags: ['restaurants'], summary: 'Lista os funcionários do restaurante (só o dono)' },
  }, async (request, reply) => {
    const result = await listMembers.execute(buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.post('/me/members', {
    schema: {
      tags: ['restaurants'],
      summary: 'Cria o login de um funcionário (só o dono)',
      body: { type: 'object', required: ['name', 'email', 'password'], properties: { name: str, email: str, password: str } },
    },
  }, async (request, reply) => {
    const result = await createMember.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.CREATED).payload(result).send(reply)
  })

  fastify.patch<{ Params: { id: string } }>('/me/members/:id', {
    schema: {
      tags: ['restaurants'],
      summary: 'Ativa/inativa um funcionário e/ou define uma senha nova (só o dono)',
      body: { type: 'object', properties: { status: str, password: str } },
    },
  }, async (request, reply) => {
    const result = await updateMember.execute(buildRequestContext(request), request.params.id, request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })
}
