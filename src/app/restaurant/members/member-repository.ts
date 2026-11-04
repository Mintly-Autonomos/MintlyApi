import { Document, ObjectId } from 'mongodb'
import { MemberStatus, UserRole, UserStatus } from 'mintly-lib'
import type { RestaurantMember } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { ConflictError } from '../../../core/errors/auth/conflict-error'

/** Funcionário = usuário com papel `member` do restaurante do token. Nunca devolve o hash da senha. */
export function toMember (doc: Document): RestaurantMember {
  return {
    _id: String(doc._id),
    name: doc.person?.name ?? '',
    email: doc.email,
    status: doc.status === UserStatus.Active ? MemberStatus.Active : MemberStatus.Inactive,
    ...(doc.lastAccessAt ? { lastAccessAt: doc.lastAccessAt } : {}),
    ...(doc.audit?.createdAt ? { createdAt: doc.audit.createdAt } : {}),
  }
}

export class MemberRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  private filter (ctx: RequestContext): Document {
    return { restaurantId: requireTenant(ctx).restaurantId, role: UserRole.Member }
  }

  async list (ctx: RequestContext): Promise<RestaurantMember[]> {
    const docs = await this.db(ctx).collection('users').find(this.filter(ctx)).sort({ 'person.name': 1 }).toArray()
    return docs.map(toMember)
  }

  async count (ctx: RequestContext): Promise<number> {
    return this.db(ctx).collection('users').countDocuments(this.filter(ctx))
  }

  /** Funcionários com acesso (os inativados não ocupam vaga do plano). */
  async countActive (ctx: RequestContext): Promise<number> {
    return this.db(ctx).collection('users').countDocuments({ ...this.filter(ctx), status: UserStatus.Active })
  }

  /** Só acha funcionário DESTE restaurante: o id de outro restaurante, ou o do dono, não existe aqui. */
  async find (id: string, ctx: RequestContext): Promise<Document | null> {
    if (!ObjectId.isValid(id)) return null
    return this.db(ctx).collection('users').findOne({ ...this.filter(ctx), _id: new ObjectId(id) })
  }

  /** Cria a pessoa e o login do funcionário juntos (transação) e garante e-mail único. */
  async create (ctx: RequestContext, data: { name: string; email: string; passwordHash: string }): Promise<RestaurantMember> {
    const { restaurantId } = requireTenant(ctx)
    const connection = MongoDBConnection.getInstance()
    const db = connection.getDatabase(ctx.env)
    const session = connection.getClient().startSession()
    let created!: Document
    try {
      await session.withTransaction(async () => {
        const now = new Date()
        const audit = { createdAt: now, updatedAt: now, createdBy: ctx.userId, updatedBy: ctx.userId }

        if (await db.collection('users').findOne({ email: data.email }, { session })) {
          throw new ConflictError('Este e-mail já está cadastrado.')
        }
        const person = await db.collection('people').insertOne({ name: data.name, phone: '', audit }, { session })
        const user = {
          person: { _id: person.insertedId.toHexString(), name: data.name },
          email: data.email,
          passwordHash: data.passwordHash,
          role: UserRole.Member,
          status: UserStatus.Active,
          restaurantId,
          audit,
        }
        const inserted = await db.collection('users').insertOne(user, { session })
        created = { ...user, _id: inserted.insertedId }
      })
    } catch (err) {
      // Dois pedidos ao mesmo tempo para o mesmo e-mail: o índice único decide.
      if ((err as { code?: number })?.code === 11000) throw new ConflictError('Este e-mail já está cadastrado.')
      throw err
    } finally {
      await session.endSession()
    }
    return toMember(created)
  }

  async setStatus (id: string, status: MemberStatus, ctx: RequestContext): Promise<void> {
    await this.db(ctx).collection('users').updateOne(
      { ...this.filter(ctx), _id: new ObjectId(id) },
      { $set: { status: status === MemberStatus.Active ? UserStatus.Active : UserStatus.Inactive, 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId } },
    )
  }
}
