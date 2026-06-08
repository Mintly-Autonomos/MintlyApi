import { ValkyrieJwtService, createMongoStores, ValkyrieTokenProtection } from 'valkyrie-jwt'
import MongoDBConnection from '../db/mongodb/mongodb-connection'

let _service: ValkyrieJwtService | null = null

export function getJwtService (): ValkyrieJwtService {
  if (!_service) {
    const db = MongoDBConnection.getInstance().getDatabase(
      process.env.MONGODB_AUTH_DB ?? process.env.MONGODB_DB ?? 'mintly',
    )
    const stores = createMongoStores(db as any)
    _service = new ValkyrieJwtService({
      issuer: process.env.JWT_ISSUER ?? 'mintly',
      accessTokenLifetimeSeconds: Number(process.env.JWT_ACCESS_LIFETIME_SECONDS ?? 900),
      refreshTokenLifetimeSeconds: Number(process.env.JWT_REFRESH_LIFETIME_SECONDS ?? 604800),
      issueRefreshTokens: true,
      tokenProtection: ValkyrieTokenProtection.Encrypted,
      stores,
    })
  }
  return _service
}
