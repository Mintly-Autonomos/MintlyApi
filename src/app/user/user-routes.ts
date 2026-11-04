import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { buildRequestContext } from '../../core/context/build-request-context'
import {
  ChangeMyEmailUseCase,
  ChangeMyPasswordUseCase,
  GetMyAccountQuery,
  UpdateMyAccountUseCase,
} from './use-cases/account.use-cases'

const str = { type: 'string' as const }

/**
 * Conta de quem está logado (`/users/me`). Registrada FORA do portão de assinatura: trocar a senha ou o
 * e-mail precisa funcionar mesmo com a assinatura vencida. O usuário vem sempre do token.
 */
export async function userRoutes (fastify: FastifyInstance) {
  const getMe = new GetMyAccountQuery()
  const updateMe = new UpdateMyAccountUseCase()
  const changeEmail = new ChangeMyEmailUseCase()
  const changePassword = new ChangeMyPasswordUseCase()

  fastify.get('/me', {
    schema: { tags: ['users'], summary: 'Dados da minha conta (nome, e-mail, telefone, papel)' },
  }, async (request, reply) => {
    const result = await getMe.execute(buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.patch('/me', {
    schema: {
      tags: ['users'],
      summary: 'Atualiza nome e/ou telefone',
      body: { type: 'object', properties: { name: str, phone: str } },
    },
  }, async (request, reply) => {
    const result = await updateMe.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.patch('/me/email', {
    schema: {
      tags: ['users'],
      summary: 'Troca o e-mail de login (exige a senha atual)',
      body: { type: 'object', required: ['email', 'currentPassword'], properties: { email: str, currentPassword: str } },
    },
  }, async (request, reply) => {
    const result = await changeEmail.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.post('/me/password', {
    schema: {
      tags: ['users'],
      summary: 'Troca a senha logado (com a antiga) e encerra todas as sessões',
      body: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: str, newPassword: str } },
    },
  }, async (request, reply) => {
    const result = await changePassword.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })
}
