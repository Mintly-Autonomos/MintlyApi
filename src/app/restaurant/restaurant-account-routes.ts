import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { buildRequestContext } from '../../core/context/build-request-context'
import { CancelDeletionUseCase, RequestDeletionUseCase } from './use-cases/deletion.use-cases'

const str = { type: 'string' as const }

/**
 * Pedido de exclusão do restaurante. Registrado FORA do portão de assinatura (junto de `/users`): quem está
 * com a assinatura vencida também precisa poder pedir a exclusão. Só o dono (a trava é no use case).
 */
export async function restaurantAccountRoutes (fastify: FastifyInstance) {
  const requestDeletion = new RequestDeletionUseCase()
  const cancelDeletion = new CancelDeletionUseCase()

  fastify.post('/me/deletion-request', {
    schema: {
      tags: ['restaurants'],
      summary: 'Pede a exclusão do restaurante (só o dono, com a senha). É só um pedido: nada é apagado',
      body: { type: 'object', required: ['password'], properties: { password: str, reason: str } },
    },
  }, async (request, reply) => {
    const result = await requestDeletion.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })

  fastify.delete('/me/deletion-request', {
    schema: { tags: ['restaurants'], summary: 'Cancela o pedido de exclusão (só o dono)' },
  }, async (request, reply) => {
    const result = await cancelDeletion.execute(buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  })
}
