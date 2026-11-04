import { UserRole } from 'mintly-lib'
import { RequestContext } from '../../core/context/request-context'
import { requireTenant } from '../../core/context/require-tenant'
import { ForbiddenError } from '../../core/errors/auth/forbidden-error'
import { AuthRepository, UserRecord } from './auth-repository'

/**
 * Só o dono do restaurante passa. O papel é lido do BANCO, não do token: o JWT guarda uma foto do usuário
 * de quando foi emitido, e um funcionário inativado depois ainda teria um token válido por alguns minutos.
 * Devolve o usuário (o use case costuma precisar dele, por exemplo para confirmar a senha).
 */
export async function requireOwner (ctx: RequestContext, repo: AuthRepository = new AuthRepository()): Promise<UserRecord> {
  const { userId, restaurantId } = requireTenant(ctx)
  const user = await repo.findById(userId, ctx).catch(() => null)
  if (!user || user.status !== 'active' || user.restaurantId !== restaurantId || user.role !== UserRole.Owner) {
    throw new ForbiddenError('Só o dono do restaurante pode fazer isso.')
  }
  return user
}
