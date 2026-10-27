import type { PersonAvatarResult } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { normalizeEmail } from '../../auth/normalize-email'
import { AuthRepository } from '../../auth/auth-repository'

/**
 * Foto de perfil pelo nome de usuário (e-mail). Escopada ao restaurante do token: quem é de
 * outro restaurante (ou não existe) responde igual a "sem foto" — não revela se o e-mail existe.
 */
export class GetPersonAvatarUseCase {
  private readonly authRepo = new AuthRepository()

  async execute (username: string, ctx: RequestContext): Promise<PersonAvatarResult> {
    const { restaurantId } = requireTenant(ctx)
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    const user = await db.collection('users').findOne(
      { email: normalizeEmail(username), restaurantId },
      { projection: { person: 1 } },
    )
    const personId = user?.person?._id
    if (typeof personId !== 'string') return { avatar: null }
    return { avatar: await this.authRepo.findPersonAvatar(personId, ctx) }
  }
}
