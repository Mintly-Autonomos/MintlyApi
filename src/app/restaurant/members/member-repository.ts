import { Document, ObjectId } from 'mongodb'
import { MEMBER_PROFILE_DEFAULT, MemberProfile, MemberStatus, UserRole, UserStatus } from 'mintly-lib'
import type { RestaurantMember } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { ConflictError } from '../../../core/errors/auth/conflict-error'

const STATUS_TO_MEMBER: Record<string, MemberStatus> = {
  [UserStatus.Active]: MemberStatus.Active,
  [UserStatus.Invited]: MemberStatus.Invited,
}

/** Funcionário = usuário com papel `member` do restaurante do token. Nunca devolve o hash da senha. */
export function toMember (doc: Document, inviteExpiresAt?: Date): RestaurantMember {
  const status = STATUS_TO_MEMBER[doc.status] ?? MemberStatus.Inactive
  return {
    _id: String(doc._id),
    name: doc.person?.name ?? '',
    email: doc.email,
    status,
    profile: doc.memberProfile === MemberProfile.Operations ? MemberProfile.Operations : MEMBER_PROFILE_DEFAULT,
    ...(status === MemberStatus.Invited && inviteExpiresAt ? { inviteExpiresAt } : {}),
    ...(doc.lastAccessAt ? { lastAccessAt: doc.lastAccessAt } : {}),
    ...(doc.audit?.createdAt ? { createdAt: doc.audit.createdAt } : {}),
  }
}

export class MemberRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /** Funcionários do restaurante do token; o excluído (E.2) não aparece em lugar nenhum. */
  private filter (ctx: RequestContext): Document {
    return { restaurantId: requireTenant(ctx).restaurantId, role: UserRole.Member, status: { $ne: UserStatus.Removed } }
  }

  async list (ctx: RequestContext, inviteExpiries: (ids: string[]) => Promise<Map<string, Date>>): Promise<RestaurantMember[]> {
    const docs = await this.db(ctx).collection('users').find(this.filter(ctx)).sort({ 'person.name': 1 }).toArray()
    const invited = docs.filter((d) => d.status === UserStatus.Invited).map((d) => String(d._id))
    const expiries = await inviteExpiries(invited)
    return docs.map((d) => toMember(d, expiries.get(String(d._id))))
  }

  async count (ctx: RequestContext): Promise<number> {
    return this.db(ctx).collection('users').countDocuments(this.filter(ctx))
  }

  /** Funcionários que ocupam vaga do plano: com acesso e com convite pendente (os inativados não). */
  async countActive (ctx: RequestContext): Promise<number> {
    return this.db(ctx).collection('users').countDocuments({ ...this.filter(ctx), status: { $in: [UserStatus.Active, UserStatus.Invited] } })
  }

  /** Só acha funcionário DESTE restaurante: o id de outro restaurante, ou o do dono, não existe aqui. */
  async find (id: string, ctx: RequestContext): Promise<Document | null> {
    if (!ObjectId.isValid(id)) return null
    return this.db(ctx).collection('users').findOne({ ...this.filter(ctx), _id: new ObjectId(id) })
  }

  /**
   * Cria a pessoa e o login do funcionário juntos (transação) e garante e-mail único. Nasce `invited`, sem
   * senha (`passwordHash` vazio nunca confere no login): o funcionário cria a dele pelo convite (E.1).
   */
  async create (ctx: RequestContext, data: { name: string; email: string; profile: MemberProfile }): Promise<Document> {
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
          passwordHash: '',
          role: UserRole.Member,
          status: UserStatus.Invited,
          memberProfile: data.profile,
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
    return created
  }

  private touched (ctx: RequestContext) {
    return { 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId }
  }

  async setStatus (id: string, status: UserStatus, ctx: RequestContext): Promise<void> {
    await this.db(ctx).collection('users').updateOne(
      { ...this.filter(ctx), _id: new ObjectId(id) },
      { $set: { status, ...this.touched(ctx) } },
    )
  }

  /** Nome (no login e na pessoa), e-mail e perfil. E-mail de outro usuário → 409. */
  async updateFields (member: Document, changes: { name?: string; email?: string; profile?: MemberProfile }, ctx: RequestContext): Promise<void> {
    const db = this.db(ctx)
    const set: Document = { ...this.touched(ctx) }
    if (changes.name !== undefined) set['person.name'] = changes.name
    if (changes.email !== undefined) {
      const other = await db.collection('users').findOne({ email: changes.email, _id: { $ne: member._id } })
      if (other) throw new ConflictError('Este e-mail já está cadastrado.')
      set.email = changes.email
    }
    if (changes.profile !== undefined) set.memberProfile = changes.profile
    try {
      await db.collection('users').updateOne({ ...this.filter(ctx), _id: member._id }, { $set: set })
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) throw new ConflictError('Este e-mail já está cadastrado.')
      throw err
    }
    if (changes.name !== undefined && member.person?._id && ObjectId.isValid(member.person._id)) {
      await db.collection('people').updateOne({ _id: new ObjectId(member.person._id) }, { $set: { name: changes.name, 'audit.updatedAt': new Date() } })
    }
  }

  /**
   * Exclui o funcionário (E.2): sai da lista, perde a senha e libera o e-mail (que vai para `removedEmail`;
   * o `email` vira um endereço que não existe, para o índice único). O documento fica: o histórico dos
   * lançamentos que ele fez continua mostrando o nome.
   */
  async remove (member: Document, ctx: RequestContext): Promise<void> {
    const id = String(member._id)
    await this.db(ctx).collection('users').updateOne(
      { ...this.filter(ctx), _id: member._id },
      { $set: { status: UserStatus.Removed, passwordHash: '', email: `removido-${id}@removido.mintly.invalid`, removedEmail: member.email, removedAt: new Date(), ...this.touched(ctx) } },
    )
  }
}
