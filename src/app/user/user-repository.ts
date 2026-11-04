import { ObjectId } from 'mongodb'
import type { MyAccount } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { UserRecord } from '../auth/auth-repository'

/** Dados da conta de quem está logado: `users` (e-mail, papel) + `people` (nome, telefone). */
export class UserRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /** Conta no formato público (nunca o hash da senha, sempre sem a foto: ela pesa e já vem no login). */
  async getAccount (user: UserRecord, ctx: RequestContext): Promise<MyAccount> {
    const person = ObjectId.isValid(user.person._id)
      ? await this.db(ctx).collection('people').findOne({ _id: new ObjectId(user.person._id) }, { projection: { name: 1, phone: 1 } })
      : null
    return {
      name: person?.name ?? user.person.name,
      email: user.email,
      phone: typeof person?.phone === 'string' ? person.phone : '',
      role: user.role,
    }
  }

  /**
   * Grava nome e/ou telefone. O nome vive em dois lugares (o `people` e a referência dentro de `users`):
   * os dois mudam juntos, numa transação, para nunca divergirem.
   */
  async updateProfile (user: UserRecord, changes: { name?: string; phone?: string }, ctx: RequestContext): Promise<void> {
    if (!ObjectId.isValid(user.person._id)) throw new NotFoundError(Resource.Person, user.person._id)
    const connection = MongoDBConnection.getInstance()
    const db = connection.getDatabase(ctx.env)
    const now = new Date()
    const session = connection.getClient().startSession()
    try {
      await session.withTransaction(async () => {
        const personSet: Record<string, unknown> = { 'audit.updatedAt': now, 'audit.updatedBy': ctx.userId }
        if (changes.name !== undefined) personSet.name = changes.name
        if (changes.phone !== undefined) personSet.phone = changes.phone
        const person = await db.collection('people').updateOne({ _id: new ObjectId(user.person._id) }, { $set: personSet }, { session })
        if (person.matchedCount === 0) throw new NotFoundError(Resource.Person, user.person._id)

        const userSet: Record<string, unknown> = { 'audit.updatedAt': now, 'audit.updatedBy': ctx.userId }
        if (changes.name !== undefined) userSet['person.name'] = changes.name
        await db.collection('users').updateOne({ _id: new ObjectId(String(user._id)) }, { $set: userSet }, { session })
      })
    } finally {
      await session.endSession()
    }
  }

  async emailInUse (email: string, ctx: RequestContext): Promise<boolean> {
    return (await this.db(ctx).collection('users').findOne({ email }, { projection: { _id: 1 } })) !== null
  }

  async updateEmail (userId: string, email: string, ctx: RequestContext): Promise<void> {
    await this.db(ctx).collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { email, 'audit.updatedAt': new Date(), 'audit.updatedBy': userId } },
    )
  }
}
