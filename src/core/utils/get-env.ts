import { IncomingHttpHeaders } from 'http'

export class GetEnv {
  static getEnv (headers?: IncomingHttpHeaders): string {
    const env = headers?.env || headers?.env || 'default'
    return String(env)
  }
}
