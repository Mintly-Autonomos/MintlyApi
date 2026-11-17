import { Collection } from 'mongodb'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'

/** Convite de funcionário (E.1): o token em claro só viaja no e-mail; aqui fica o sha256. */
export interface MemberInviteRecord {
  token: string
  userId: string
  restaurantId: string
  /** Date (não ISO): o índice TTL do Mongo só funciona com BSON Date. */
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}

const indexedEnvs = new Set<string>()

/**
 * Coleção separada da de recuperação de senha: um token de convite não serve para redefinir senha, e um de
 * recuperação não aceita convite.
 */
export class MemberInviteRepository {
  constructor (private readonly env: string) {}

  private async collection (): Promise<Collection<MemberInviteRecord>> {
    const col = MongoDBConnection.getInstance().getDatabase(this.env).collection<MemberInviteRecord>('member_invites')
    if (!indexedEnvs.has(this.env)) {
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      await col.createIndex({ token: 1 }, { unique: true })
      indexedEnvs.add(this.env)
    }
    return col
  }

  async create (record: MemberInviteRecord): Promise<void> {
    await (await this.collection()).insertOne(record)
  }

  /** Convite válido (não usado, não vencido) sem consumir: para a tela mostrar para quem é. */
  async findValid (tokenHash: string): Promise<MemberInviteRecord | null> {
    return (await this.collection()).findOne({ token: tokenHash, usedAt: null, expiresAt: { $gt: new Date() } })
  }

  /** Consome o convite atomicamente (uso único mesmo com dois pedidos ao mesmo tempo). */
  async claim (tokenHash: string): Promise<MemberInviteRecord | null> {
    return (await this.collection()).findOneAndUpdate(
      { token: tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { returnDocument: 'after' },
    )
  }

  /** Invalida os convites pendentes do funcionário (reenvio, troca de e-mail, exclusão). */
  async invalidateAllForUser (userId: string): Promise<void> {
    await (await this.collection()).updateMany({ userId, usedAt: null }, { $set: { usedAt: new Date() } })
  }

  /** Validade do convite pendente mais recente de cada funcionário (para a lista mostrar). */
  async pendingExpiries (userIds: string[]): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map()
    const docs = await (await this.collection())
      .find({ userId: { $in: userIds }, usedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ expiresAt: 1 })
      .toArray()
    return new Map(docs.map((d) => [d.userId, d.expiresAt]))
  }
}
