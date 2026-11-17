import type { AccessLevel } from 'mintly-lib'

export interface RequestContext {
  env: string
  /** Presentes apenas em rotas protegidas — populados a partir do JWT pelo buildRequestContext(request). */
  userId?: string
  restaurantId?: string
  /** Nível de acesso de quem pede (E.3): preenchido pelo `enforceAccessLevel` nas rotas protegidas. */
  accessLevel?: AccessLevel
  // Campos futuros previstos (adicionar quando necessário):
  // traceId?: string
  // logger?: Logger
}
