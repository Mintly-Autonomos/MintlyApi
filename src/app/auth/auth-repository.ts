import { Collection, ObjectId } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { User } from '../user/user'
import { authDbName } from './auth-db'

export class AuthRepository {
  constructor (private readonly env = 'default') {}

  private getCollection (): Collection<User> {
    return MongoDBConnection.getInstance()
      .getDatabase(authDbName(this.env))
      .collection<User>('users')
  }

  async findByEmail (email: string): Promise<User | null> {
    return this.getCollection().findOne({ email })
  }

  async findById (userId: string): Promise<User | null> {
    return this.getCollection().findOne({ _id: new ObjectId(userId) as any })
  }

  async create (user: Omit<User, '_id'>): Promise<User> {
    const result = await this.getCollection().insertOne(user as User)
    return { ...user, _id: result.insertedId.toString() }
  }

  async updateLastAccess (userId: string): Promise<void> {
    await this.getCollection().updateOne(
      { _id: new ObjectId(userId) as any },
      { $set: { lastAccessAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    )
  }

  async incrementLoginAttempts (userId: string): Promise<number> {
    const result = await this.getCollection().findOneAndUpdate(
      { _id: new ObjectId(userId) as any },
      { $inc: { loginAttempts: 1 }, $set: { updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    )
    return result?.loginAttempts ?? 1
  }

  async resetLoginAttempts (userId: string): Promise<void> {
    await this.getCollection().updateOne(
      { _id: new ObjectId(userId) as any },
      { $set: { loginAttempts: 0, blockedUntil: null, updatedAt: new Date().toISOString() } },
    )
  }

  async setTemporaryBlock (userId: string, blockedUntil: Date): Promise<void> {
    await this.getCollection().updateOne(
      { _id: new ObjectId(userId) as any },
      { $set: { blockedUntil: blockedUntil.toISOString(), updatedAt: new Date().toISOString() } },
    )
  }

  async updatePassword (userId: string, passwordHash: string): Promise<void> {
    await this.getCollection().updateOne(
      { _id: new ObjectId(userId) as any },
      { $set: { passwordHash, loginAttempts: 0, blockedUntil: null, updatedAt: new Date().toISOString() } },
    )
  }
}
