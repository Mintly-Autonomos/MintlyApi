import { IncomingHttpHeaders } from 'http'
import { RequestContext } from './request-context'

export function buildRequestContext (headers?: IncomingHttpHeaders): RequestContext {
  const env = headers?.env ?? 'default'
  return {
    env: Array.isArray(env) ? String(env[0]) : String(env),
  }
}
