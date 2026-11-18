import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { buildRequestContext } from '../../core/context/build-request-context'
import { RestaurantController } from './restaurant-controller'
import { CreateMemberUseCase, DeleteMemberUseCase, ListMembersQuery, ResendInviteUseCase, UpdateMemberUseCase } from './members/member.use-cases'

const str = { type: 'string' as const }

export async function restaurantRoutes (fastify: FastifyInstance) {
  const controller = new RestaurantController()
  const listMembers = new ListMembersQuery()
  const createMember = new CreateMemberUseCase()
  const updateMember = new UpdateMemberUseCase()
  const resendInvite = new ResendInviteUseCase()
  const deleteMember = new DeleteMemberUseCase()

  // GET /restaurants/me?month=AAAA-MM — restaurante + perfil tributário (MIN-23).
  fastify.get('/me', async (request: any, reply) => controller.me(request, reply))

  // POST /restaurants/me/first-access — conclui o onboarding: grava firstAccessAt (hora do servidor).
  // Sem corpo; repetir não muda a data; restaurante antigo (sem o campo) não é alterado.
  fastify.post('/me/first-access', async (request: any, reply) => controller.completeFirstAccess(request, reply))

  // PATCH /restaurants/me — body: { name?, taxRegime?, team? }. Só o dono. `team` troca a lista inteira (P.4).
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
      summary: 'Convida um funcionário por e-mail: nome, e-mail e perfil (só o dono)',
      body: { type: 'object', required: ['name', 'email'], properties: { name: str, email: str, profile: str } },
    },
  }, async (request, reply) => {
    const result = await createMember.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.CREATED).payload(result).send(reply)
  })

  fastify.patch<{ Params: { id: string } }>('/me/members/:id', {
    schema: {
      tags: ['restaurants'],
      summary: 'Ativa/inativa, muda nome, e-mail ou perfil de um funcionário (só o dono)',
      body: { type: 'object', properties: { status: str, name: str, email: str, profile: str } },
    },
  }, async (request, reply) => {
    const result = await updateMember.execute(buildRequestContext(request), request.params.id, request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.post<{ Params: { id: string } }>('/me/members/:id/invite', {
    schema: { tags: ['restaurants'], summary: 'Reenvia o convite de um funcionário que ainda não criou a senha (só o dono)' },
  }, async (request, reply) => {
    const result = await resendInvite.execute(buildRequestContext(request), request.params.id)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.delete<{ Params: { id: string } }>('/me/members/:id', {
    schema: { tags: ['restaurants'], summary: 'Exclui um funcionário: perde o acesso e libera a vaga e o e-mail (só o dono)' },
  }, async (request, reply) => {
    await deleteMember.execute(buildRequestContext(request), request.params.id)
    return reply.status(StatusCodes.NO_CONTENT).send()
  })
}
