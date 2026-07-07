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
  blockedUntil?: Date | null
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

  async findById (userId: string, ctx: RequestContext): Promise<UserRecord | null> {
    const user = await this.getCollection(ctx).findOne({ _id: new ObjectId(userId) })
    return user as UserRecord | null
  }

  async updateLastAccess (userId: string, ctx: RequestContext): Promise<void> {
    const now = new Date()
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { lastAccessAt: now, 'audit.updatedAt': now } },
    )
  }

  /**
   * Registra uma tentativa de login falha de forma ATÔMICA: incrementa
   * `loginAttempts` e, se o novo valor cruzar `maxAttempts`, grava o bloqueio e
   * zera o contador na MESMA operação (update com pipeline de agregação). Assim
   * não há corrida entre "incrementar" e "bloquear" (o gate não-atômico deixava
   * o lockout ser burlado sob concorrência). Zerar o contador ao bloquear evita
   * o re-bloqueio imediato quando a janela expira (DoS da conta legítima).
   *
   * @returns `attempts` (contagem que disparou o evento) e `blocked` (se este
   *   attempt cruzou o teto e bloqueou a conta agora).
   */
  async registerFailedAttempt (
    userId: string,
    maxAttempts: number,
    blockedUntil: Date,
    ctx: RequestContext,
  ): Promise<{ attempts: number; blocked: boolean }> {
    const result = await this.getCollection(ctx).findOneAndUpdate(
      { _id: new ObjectId(userId) },
      [
        {
          $set: {
            loginAttempts: { $add: [{ $ifNull: ['$loginAttempts', 0] }, 1] },
            'audit.updatedAt': '$$NOW',
          },
        },
        {
          // `$loginAttempts` aqui já é o valor incrementado (estágio anterior).
          // `blockedUntil` é gravado como Date (BSON), consistente com as demais datas.
          $set: {
            blockedUntil: {
              $cond: [{ $gte: ['$loginAttempts', maxAttempts] }, blockedUntil, '$blockedUntil'],
            },
            loginAttempts: {
              $cond: [{ $gte: ['$loginAttempts', maxAttempts] }, 0, '$loginAttempts'],
            },
          },
        },
      ],
      { returnDocument: 'after' },
    )
    const doc = result as UserRecord | null
    // Antes deste attempt a conta não estava bloqueada-no-futuro (o gate garante):
    // se `blockedUntil` agora é o instante que passamos, foi este attempt que bloqueou.
    const stored = doc?.blockedUntil != null ? new Date(doc.blockedUntil).getTime() : null
    const blocked = stored === blockedUntil.getTime()
    const attempts = blocked ? maxAttempts : (doc?.loginAttempts ?? 1)
    return { attempts, blocked }
  }

  async resetLoginAttempts (userId: string, ctx: RequestContext): Promise<void> {
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { loginAttempts: 0, blockedUntil: null, 'audit.updatedAt': new Date() } },
    )
  }

  async updatePassword (userId: string, passwordHash: string, ctx: RequestContext): Promise<void> {
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(userId) },
      { $set: { passwordHash, loginAttempts: 0, blockedUntil: null, 'audit.updatedAt': new Date() } },
    )
  }
}
