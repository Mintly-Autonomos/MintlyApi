import type { FastifyRequest } from 'fastify'
import type { MintlyClaims } from '../../app/auth/jwt-claims'
import type { UserRole, UserStatus } from '../../app/user/user'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

export interface RequestUser {
  userId: string
  name: string
  email: string
  cpf?: string
  restaurantId: string
  role: UserRole
  status: UserStatus
}

/**
 * Extrai e tipifica os claims do JWT descriptografado pelo verify-jwt hook.
 * Lança UnauthorizedError se o hook não foi executado (rota sem proteção).
 */
export function getRequestUser (request: FastifyRequest): RequestUser {
  const jwt = (request as any).jwtClaims as { subject: string; claims: MintlyClaims } | undefined
  if (!jwt) throw new UnauthorizedError('Token não fornecido')
  return {
    userId: jwt.subject,
    name: jwt.claims.name,
    email: jwt.claims.email,
    cpf: jwt.claims.cpf,
    restaurantId: jwt.claims.restaurantId,
    role: jwt.claims.role,
    status: jwt.claims.status,
  }
}
