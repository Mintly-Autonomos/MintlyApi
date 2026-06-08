import { Collection, ObjectId } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { User } from '../user/user'

export class AuthRepository {
  private getCollection (): Collection<User> {
    const db = MongoDBConnection.getInstance().getDatabase(
      process.env.MONGODB_AUTH_DB ?? process.env.MONGODB_DB ?? 'mintly',
    )
    return db.collection<User>('users')
  }

  async findByEmail (email: string): Promise<User | null> {
    return this.getCollection().findOne({ email })
  }

  async create (user: Omit<User, '_id'>): Promise<User> {
    const result = await this.getCollection().insertOne(user as User)
    return { ...user, _id: result.insertedId.toString() }
  }

  async updateLastAccess (userId: string): Promise<void> {
    await this.getCollection().updateOne(
      { _id: new ObjectId(userId) as any },
      { $set: { ultimoAcesso: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    )
  }
}
