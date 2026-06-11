export interface RequestContext {
  env: string
  /** Presentes apenas em rotas protegidas — populados a partir do JWT pelo buildRequestContext(request). */
  userId?: string
  restaurantId?: string
  // Campos futuros previstos (adicionar quando necessário):
  // traceId?: string
  // logger?: Logger
}
