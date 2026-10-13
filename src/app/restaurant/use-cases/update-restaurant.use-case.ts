import { restaurantUpdateSchema } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { ValidationError } from '../../../core/errors/core/validation-error'
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
    // O `.partial()` do Sapphire aceita null: recusamos aqui. Nome vazio deixaria o
    // restaurante sem nome; "desconfigurar" o regime não está na spec.
    if ('name' in changes && (typeof changes.name !== 'string' || changes.name.trim() === '')) {
      throw new ValidationError('name não pode ser vazio.')
    }
    if ('taxRegime' in changes && changes.taxRegime == null) {
      throw new ValidationError('taxRegime inválido: use mei ou simplesNacionalAnexoI.')
    }
    if (Object.keys(changes).length === 0) return this.repo.findMine(ctx)
    return this.repo.updateMine(ctx, {
      ...changes,
      'audit.updatedAt': new Date(),
      'audit.updatedBy': ctx.userId,
    })
  }
}
