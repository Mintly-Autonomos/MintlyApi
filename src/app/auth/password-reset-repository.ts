import { Collection } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { PasswordResetToken } from './password-reset-token'

export class PasswordResetRepository {
  constructor (private readonly env = 'default') {}

  private getCollection (): Collection<PasswordResetToken> {
    return MongoDBConnection.getInstance()
      .getDatabase(this.env)
      .collection<PasswordResetToken>('password_reset_tokens')
  }

  async create (record: Omit<PasswordResetToken, '_id'>): Promise<void> {
    const collection = this.getCollection()
    // TTL: o Mongo apaga o documento quando expiresAt passa (createIndex é idempotente).
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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
