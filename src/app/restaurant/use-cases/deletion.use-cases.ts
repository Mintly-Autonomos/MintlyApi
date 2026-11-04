import { deletionRequestSchema } from 'mintly-lib'
import type { DeletionStatus } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { logAudit } from '../../audit/audit-service'
import { AuthRepository } from '../../auth/auth-repository'
import { confirmCurrentPassword } from '../../auth/password-confirmation'
import { requireOwner } from '../../auth/require-owner'
import { RestaurantRepository } from '../restaurant-repository'

/**
 * POST /restaurants/me/deletion-request — o dono PEDE a exclusão do restaurante, confirmando com a senha.
 * É só um pedido: nada é apagado aqui (a análise e a exclusão em si são feitas fora da API), e o dono pode
 * cancelar. Pedir de novo não muda a data do primeiro pedido.
 */
export class RequestDeletionUseCase {
  constructor (
    private readonly repo: RestaurantRepository = new RestaurantRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, body: unknown): Promise<DeletionStatus> {
    const owner = await requireOwner(ctx, this.auth)
    const input = deletionRequestSchema.parse(body ?? {}) as { password: string; reason?: string }
    await confirmCurrentPassword(owner, input.password, ctx, this.auth)

    const restaurant = await this.repo.findMine(ctx)
    if (restaurant.deletionRequestedAt) return { deletionRequestedAt: restaurant.deletionRequestedAt }

    const now = new Date()
    await this.repo.setDeletionRequested(ctx, now)
    await logAudit('deletion_requested', String(owner._id), ctx.env, owner.restaurantId, {
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    }).catch(() => null)
    return { deletionRequestedAt: now }
  }
}

/** DELETE /restaurants/me/deletion-request — o dono desiste do pedido. Sem pedido, não faz nada. */
export class CancelDeletionUseCase {
  constructor (
    private readonly repo: RestaurantRepository = new RestaurantRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext): Promise<DeletionStatus> {
    const owner = await requireOwner(ctx, this.auth)
    const restaurant = await this.repo.findMine(ctx)
    if (restaurant.deletionRequestedAt) {
      await this.repo.clearDeletionRequested(ctx)
      await logAudit('deletion_cancelled', String(owner._id), ctx.env, owner.restaurantId, {}).catch(() => null)
    }
    return { deletionRequestedAt: null }
  }
}
