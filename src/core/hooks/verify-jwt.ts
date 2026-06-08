import { FastifyRequest, FastifyReply } from 'fastify'
import { getJwtService } from '../../infrastructure/jwt/jwt-service'

export async function verifyJwt (request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Token não fornecido' })
  }

  const token = authorization.slice(7)
  const jwt = getJwtService()
  const result = await jwt.validate(token)

  if (!result.succeeded) {
    return reply.status(401).send({ code: 'UNAUTHORIZED', message: result.failureReason ?? 'Token inválido' })
  }

  // Attach validated claims for downstream handlers
  ;(request as any).jwtClaims = result
}
