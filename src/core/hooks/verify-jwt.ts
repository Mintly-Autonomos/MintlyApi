import { FastifyRequest } from 'fastify'
import { getJwtService } from '../../infrastructure/jwt/jwt-service'
import { buildRequestContext } from '../context/build-request-context'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

/**
 * preHandler que exige um Bearer token válido. Lança UnauthorizedError, que o
 * error handler global converte no mesmo envelope dos demais erros (AUTH-0001).
 */
export async function verifyJwt (request: FastifyRequest): Promise<void> {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token não fornecido')
  }

  const token = authorization.slice(7)
  const ctx = buildRequestContext(request.headers)
  const result = await getJwtService(ctx.env).validate(token)

  if (!result.succeeded) {
    throw new UnauthorizedError(result.failureReason ?? 'Token inválido')
  }

  ;(request as any).jwtClaims = result
}
