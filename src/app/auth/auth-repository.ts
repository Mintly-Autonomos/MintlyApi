import { Collection, ObjectId, Document } from 'mongodb'
import { User } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'

export class AuthRepository {
  private getCollection (ctx: RequestContext): Collection<Document> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    return db.collection('users')
  }

  async findByEmail (email: string, ctx: RequestContext): Promise<User | null> {
    const user = await this.getCollection(ctx).findOne({ email })
    return user as User | null
  }

  async updateLastAccess (userId: string, ctx: RequestContext): Promise<void> {
    const now = new Date().toISOString()
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { lastAccessAt: now, 'audit.updatedAt': now } },
    )
  }
}
