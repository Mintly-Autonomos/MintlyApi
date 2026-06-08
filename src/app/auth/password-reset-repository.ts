import { Collection } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { PasswordResetToken } from './password-reset-token'

export class PasswordResetRepository {
  private getCollection (): Collection<PasswordResetToken> {
    const db = MongoDBConnection.getInstance().getDatabase(
      process.env.MONGODB_AUTH_DB ?? process.env.MONGODB_DB ?? 'mintly',
    )
    return db.collection<PasswordResetToken>('password_reset_tokens')
  }

  async create (record: Omit<PasswordResetToken, '_id'>): Promise<void> {
    await this.getCollection().insertOne(record as PasswordResetToken)
  }

  async findValid (token: string): Promise<PasswordResetToken | null> {
    return this.getCollection().findOne({
      token,
      usedAt: null,
      expiresAt: { $gt: new Date().toISOString() },
    })
  }

  async markUsed (token: string): Promise<void> {
    await this.getCollection().updateOne(
      { token },
      { $set: { usedAt: new Date().toISOString() } },
    )
  }

  async invalidateAllForUser (userId: string): Promise<void> {
    await this.getCollection().updateMany(
      { userId, usedAt: null },
      { $set: { usedAt: new Date().toISOString() } },
    )
  }
}
