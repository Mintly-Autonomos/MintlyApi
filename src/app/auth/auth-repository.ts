import { Collection, ObjectId, Document } from 'mongodb'
import { User } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'

/**
 * Documento de usuário com os campos internos de auth (lockout). Não fazem parte
 * do contrato compartilhado da lib (User) — são estado server-side.
 */
export type UserRecord = User & {
  loginAttempts?: number
  blockedUntil?: string | null
}

export class AuthRepository {
  private getCollection (ctx: RequestContext): Collection<Document> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    return db.collection('users')
  }

  async findByEmail (email: string, ctx: RequestContext): Promise<UserRecord | null> {
    const user = await this.getCollection(ctx).findOne({ email })
    return user as UserRecord | null
  }

  async updateLastAccess (userId: string, ctx: RequestContext): Promise<void> {
    const now = new Date().toISOString()
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { lastAccessAt: now, 'audit.updatedAt': now } },
    )
  }

  async incrementLoginAttempts (userId: string, ctx: RequestContext): Promise<number> {
    const result = await this.getCollection(ctx).findOneAndUpdate(
      { _id: new ObjectId(userId) },
      { $inc: { loginAttempts: 1 }, $set: { 'audit.updatedAt': new Date().toISOString() } },
      { returnDocument: 'after' },
    )
    return (result as UserRecord | null)?.loginAttempts ?? 1
  }

  async resetLoginAttempts (userId: string, ctx: RequestContext): Promise<void> {
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { loginAttempts: 0, blockedUntil: null, 'audit.updatedAt': new Date().toISOString() } },
    )
  }

  async setTemporaryBlock (userId: string, blockedUntil: Date, ctx: RequestContext): Promise<void> {
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { blockedUntil: blockedUntil.toISOString(), 'audit.updatedAt': new Date().toISOString() } },
    )
  }

  async updatePassword (userId: string, passwordHash: string, ctx: RequestContext): Promise<void> {
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { passwordHash, loginAttempts: 0, blockedUntil: null, 'audit.updatedAt': new Date().toISOString() } },
    )
  }
}
