import { RestaurantProfileResponse } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { RestaurantRepository } from '../restaurant-repository'
import { TaxProfileQuery } from '../../tax/tax-profile.query'
import { parseReferenceMonth } from '../../reports/shared/period'

/** GET /restaurants/me — restaurante + perfil tributário do mês. Read-only. */
export class GetRestaurantProfileQuery {
  constructor (
    private readonly repo: RestaurantRepository = new RestaurantRepository(),
    private readonly taxQuery: TaxProfileQuery = new TaxProfileQuery(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, month: string | undefined): Promise<RestaurantProfileResponse> {
    const referenceMonth = parseReferenceMonth(month, this.clock())
    const restaurant = await this.repo.findMine(ctx)
    const tax = await this.taxQuery.execute(ctx, { regime: restaurant.taxRegime ?? null, referenceMonth })
    return { restaurant, tax }
  }
}
