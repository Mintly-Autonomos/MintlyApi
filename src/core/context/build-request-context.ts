import { IncomingHttpHeaders } from 'http'
import { RequestContext } from './request-context'
import { MissingEnvError } from '../errors/core/missing-env-error'

/**
 * Forma estrutural mínima de um FastifyRequest: headers + os claims que o
 * verify-jwt anexa em rotas protegidas.
 *
 * ValkyrieJwtService.validate() retorna claims como Record<string, string[]>
 * (cada valor é um array), daí o tipo abaixo.
 */
export interface RequestWithContext {
  headers: IncomingHttpHeaders
  jwtClaims?: { subject?: string; claims?: Record<string, string[]> }
}

export type ContextSource = IncomingHttpHeaders | RequestWithContext

/**
 * Monta o RequestContext. Recebendo o request (rotas protegidas), a identidade
 * (userId/restaurantId) vem do JWT validado pelo verify-jwt — nunca de header,
 * que é controlado pelo cliente. Recebendo só headers, extrai apenas o env.
 */
export function buildRequestContext (source?: ContextSource): RequestContext {
  const isRequest = !!source && typeof (source as RequestWithContext).headers === 'object'
  const headers = isRequest ? (source as RequestWithContext).headers : source as IncomingHttpHeaders | undefined

  // `env` é obrigatório: roteia a requisição para o banco do tenant. Sem ele,
  // um default silencioso grava no banco errado e mascara erro de configuração.
  const rawEnv = headers?.env
  const env = Array.isArray(rawEnv) ? rawEnv[0] : rawEnv
  if (!env || String(env).trim() === '') {
    throw new MissingEnvError()
  }
  const ctx: RequestContext = {
    env: String(env),
  }

  const jwt = isRequest ? (source as RequestWithContext).jwtClaims : undefined
  if (jwt) {
    ctx.userId = jwt.subject
    // Valkyrie retorna cada claim como string[] — extrai o primeiro elemento.
    const rid = jwt.claims?.restaurantId
    ctx.restaurantId = Array.isArray(rid) ? rid[0] : rid as string | undefined
  }

  return ctx
}
