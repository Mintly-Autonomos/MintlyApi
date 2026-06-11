import { RequestContext } from './request-context'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

export interface TenantContext {
  userId: string
  restaurantId: string
}

/**
 * Garante que o contexto carrega a identidade vinda do JWT. Se faltar, a rota
 * foi registrada sem o verify-jwt (ou o controller passou headers em vez do
 * request) — falha fechado com 401 em vez de vazar dados sem escopo de tenant.
 */
export function requireTenant (ctx: RequestContext): TenantContext {
  if (!ctx.userId || !ctx.restaurantId) {
    throw new UnauthorizedError('Token não fornecido')
  }
  return { userId: ctx.userId, restaurantId: ctx.restaurantId }
}
