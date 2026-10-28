import { ObjectId } from 'mongodb'
import { updateAvatarRequestSchema } from 'mintly-lib'
import type { PersonAvatarResult } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { logAudit } from '../../audit/audit-service'

/**
 * Troca/remoção da foto de perfil do PRÓPRIO usuário autenticado. A pessoa vem do token
 * (user -> person), nunca de um id na URL: não dá pra mexer na foto de outra pessoa.
 */
export class UpdatePersonAvatarUseCase {
  async update (rawBody: unknown, ctx: RequestContext): Promise<PersonAvatarResult> {
    const { avatar } = updateAvatarRequestSchema.parse(rawBody)
    await this.apply({ $set: { avatar, 'audit.updatedAt': new Date() } }, ctx, 'avatar_updated')
    return { avatar }
  }

  async remove (ctx: RequestContext): Promise<PersonAvatarResult> {
    await this.apply({ $set: { 'audit.updatedAt': new Date() }, $unset: { avatar: '' } }, ctx, 'avatar_removed')
    return { avatar: null }
  }

  private async apply (
    update: Record<string, unknown>,
    ctx: RequestContext,
    event: 'avatar_updated' | 'avatar_removed',
  ): Promise<void> {
    const { userId, restaurantId } = requireTenant(ctx)
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    const user = ObjectId.isValid(userId)
      ? await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { person: 1 } })
      : null
    const personId = user?.person?._id
    if (typeof personId !== 'string' || !ObjectId.isValid(personId)) {
      throw new UnauthorizedError('Sessão inválida. Faça login novamente.')
    }
    await db.collection('people').updateOne({ _id: new ObjectId(personId) }, update)
    await logAudit(event, userId, ctx.env, restaurantId, {}).catch(() => null)
  }
}
