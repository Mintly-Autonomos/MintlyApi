import { Collection } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { PasswordResetToken } from './password-reset-token'

// Garante o índice TTL uma vez por env (banco) por processo — antes ele era
// recriado a cada `create()` (request). `createIndex` é idempotente, mas rodá-lo
// por request é desperdício.
const indexedEnvs = new Set<string>()

export class PasswordResetRepository {
  constructor (private readonly env = 'default') {}

  private getCollection (): Collection<PasswordResetToken> {
    return MongoDBConnection.getInstance()
      .getDatabase(this.env)
      .collection<PasswordResetToken>('password_reset_tokens')
  }

  private async ensureTtlIndex (collection: Collection<PasswordResetToken>): Promise<void> {
    if (indexedEnvs.has(this.env)) return
    // TTL: o Mongo apaga o documento quando expiresAt passa.
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    indexedEnvs.add(this.env)
  }

  async create (record: Omit<PasswordResetToken, '_id'>): Promise<void> {
    const collection = this.getCollection()
    await this.ensureTtlIndex(collection)
    await collection.insertOne(record as PasswordResetToken)
  }

  /**
   * Consome o token atomicamente: valida e marca como usado num único
   * findOneAndUpdate, garantindo uso único mesmo com requisições concorrentes.
   */
  async claim (tokenHash: string): Promise<PasswordResetToken | null> {
    return this.getCollection().findOneAndUpdate(
      { token: tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    )
  }

  async invalidateAllForUser (userId: string): Promise<void> {
    await this.getCollection().updateMany(
      { userId, usedAt: null },
      { $set: { usedAt: new Date().toISOString() } },
    )
  }
}
