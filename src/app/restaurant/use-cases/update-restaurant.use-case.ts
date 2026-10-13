import { restaurantUpdateSchema } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { RestaurantRepository } from '../restaurant-repository'

/**
 * PATCH /restaurants/me — nome e regime tributário. O schema é estrito: audit,
 * restaurantId e qualquer outro campo são rejeitados (400 pelo error handler).
 * Sem distinção owner × member: nenhuma rota tem hoje (pendência registrada).
 */
export class UpdateRestaurantUseCase {
  constructor (private readonly repo: RestaurantRepository = new RestaurantRepository()) {}

  async execute (ctx: RequestContext, body: unknown): Promise<any> {
    const changes = restaurantUpdateSchema.parse(body ?? {}) as Record<string, unknown>
    if (Object.keys(changes).length === 0) return this.repo.findMine(ctx)
    return this.repo.updateMine(ctx, {
      ...changes,
      'audit.updatedAt': new Date(),
      'audit.updatedBy': ctx.userId,
    })
  }
}
