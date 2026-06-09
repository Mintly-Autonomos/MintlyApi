import { ValkyrieJwtService, createMongoStores, ValkyrieTokenProtection } from 'valkyrie-jwt'
import MongoDBConnection from '../db/mongodb/mongodb-connection'

const services = new Map<string, ValkyrieJwtService>()

/**
 * JWT service por env: os stores de token ficam no banco roteado pelo header
 * `env` (RequestContext), preservando o isolamento multi-DB — inclusive o E2E
 * (env=e2e). Cacheado por env para reutilizar a mesma instância.
 */
export function getJwtService (env: string): ValkyrieJwtService {
  let service = services.get(env)
  if (!service) {
    const db = MongoDBConnection.getInstance().getDatabase(env)
    const stores = createMongoStores(db as any)
    service = new ValkyrieJwtService({
      issuer: process.env.JWT_ISSUER ?? 'mintly',
      accessTokenLifetimeSeconds: Number(process.env.JWT_ACCESS_LIFETIME_SECONDS ?? 900),
      refreshTokenLifetimeSeconds: Number(process.env.JWT_REFRESH_LIFETIME_SECONDS ?? 604800),
      issueRefreshTokens: true,
      tokenProtection: ValkyrieTokenProtection.Encrypted,
      stores,
    })
    services.set(env, service)
  }
  return service
}
