import { ResultReport, TaxRegime } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addMonths, parseReferenceMonth } from '../../shared/period'
import { RestaurantRepository } from '../../../restaurant/restaurant-repository'
import { TaxRepository } from '../../../tax/tax-repository'
import { TaxSettingsRepository } from '../../../tax/tax-settings-repository'
import { ResultRepository } from '../result-repository'
import { HISTORY_MONTHS, computeResult, monthTax } from '../result-metrics'

/**
 * Resultado (DRE): resolve o mês, lê o regime, soma por mês × categoria, calcula o
 * imposto de cada mês com a regra da fatia 3 e entrega à regra pura. Read-only.
 */
export class ResultQuery {
  constructor (
    private readonly repo: ResultRepository = new ResultRepository(),
    private readonly restaurants: RestaurantRepository = new RestaurantRepository(),
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly settings: TaxSettingsRepository = new TaxSettingsRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, month?: string): Promise<ResultReport> {
    const referenceMonth = parseReferenceMonth(month, this.clock())
    const from = addMonths(referenceMonth, -(HISTORY_MONTHS - 1))
    const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(from, i))

    const restaurant = await this.restaurants.findMine(ctx)
    const regime: TaxRegime | null = restaurant.taxRegime ?? null

    const [rows, categories, dailyRevenue, firstMonth, revenueByMonth, dasByMonth] = await Promise.all([
      this.repo.monthlyTotals(ctx, { from, to: referenceMonth }),
      this.repo.categories(ctx),
      this.repo.dailyRevenue(ctx, referenceMonth),
      this.taxRepo.firstMovementMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(from, -13), to: referenceMonth }),
      regime === TaxRegime.Mei
        ? Promise.all(months.map(async (m) => [m, await this.settings.meiMonthlyDasAt(m)] as const)).then((e) => new Map<string, number | null>(e))
        : Promise.resolve(new Map<string, number | null>()),
    ])

    const taxByMonth = new Map(months.map((m) => [m, monthTax({ regime, month: m, firstMonth, revenueByMonth, meiMonthlyDas: dasByMonth.get(m) ?? null })]))

    return computeResult({ referenceMonth, regime, rows, categories, taxByMonth, meiMonthlyDas: dasByMonth.get(referenceMonth) ?? null, dailyRevenue })
  }
}
