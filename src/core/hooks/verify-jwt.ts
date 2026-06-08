import { FastifyRequest, FastifyReply } from 'fastify'
import { getJwtService } from '../../infrastructure/jwt/jwt-service'

// M1: formato alinhado com BaseError (AUTH-0001) em vez de código genérico UNAUTHORIZED
export async function verifyJwt (request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    return reply.status(401).send({ code: 'AUTH-0001', message: 'Token não fornecido' })
  }

  const token = authorization.slice(7)
  const jwt = getJwtService()
  const result = await jwt.validate(token)

  if (!result.succeeded) {
    return reply.status(401).send({ code: 'AUTH-0001', message: result.failureReason ?? 'Token inválido' })
  }

  ;(request as any).jwtClaims = result
}
