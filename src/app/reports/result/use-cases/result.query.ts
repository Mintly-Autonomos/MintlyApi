import { ResultHistoryMonths, ResultReport, TaxRegime } from 'mintly-lib'
import { ValidationError } from '../../../../core/errors/core/validation-error'
import { RequestContext } from '../../../../core/context/request-context'
import { addMonths, comparisonUntilDay, parseReferenceMonth } from '../../shared/period'
import { RestaurantRepository } from '../../../restaurant/restaurant-repository'
import { TaxRepository } from '../../../tax/tax-repository'
import { TaxSettingsRepository } from '../../../tax/tax-settings-repository'
import { ResultRepository } from '../result-repository'
import { HISTORY_MONTHS, MAX_FUTURE_MONTHS, computeResult, monthTax } from '../result-metrics'

/** `?historyMonths=6|12` (padrão 6). */
export function parseHistoryMonths (value: unknown): ResultHistoryMonths {
  if (value == null || value === '') return HISTORY_MONTHS
  const n = Number(value)
  if (n === 6 || n === 12) return n
  throw new ValidationError('historyMonths inválido: use 6 ou 12.')
}

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

  async execute (ctx: RequestContext, month?: string, opts: { historyMonths?: unknown } = {}): Promise<ResultReport> {
    const now = this.clock()
    const referenceMonth = parseReferenceMonth(month, now, { maxFutureMonths: MAX_FUTURE_MONTHS })
    const historyMonths = parseHistoryMonths(opts.historyMonths)
    const untilDay = comparisonUntilDay(referenceMonth, now)
    // Do mesmo mês do ano anterior (U.4) até o mês de referência: cobre o histórico de 6 ou 12 meses.
    const from = addMonths(referenceMonth, -12)
    const months = Array.from({ length: 13 }, (_, i) => addMonths(from, i))

    const restaurant = await this.restaurants.findMine(ctx)
    const regime: TaxRegime | null = restaurant.taxRegime ?? null

    const [rows, categories, dailyRevenue, firstMonth, revenueByMonth, dasByMonth] = await Promise.all([
      this.repo.monthlyTotals(ctx, { from, to: referenceMonth }, untilDay),
      this.repo.categories(ctx),
      this.repo.dailyRevenue(ctx, referenceMonth),
      this.taxRepo.firstRevenueMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(from, -13), to: referenceMonth }),
      regime === TaxRegime.Mei
        ? Promise.all(months.map(async (m) => [m, await this.settings.meiMonthlyDasAt(m)] as const)).then((e) => new Map<string, number | null>(e))
        : Promise.resolve(new Map<string, number | null>()),
    ])

    const taxByMonth = new Map(months.map((m) => [m, monthTax({ regime, month: m, firstMonth, revenueByMonth, meiMonthlyDas: dasByMonth.get(m) ?? null })]))

    return computeResult({ referenceMonth, regime, rows, categories, taxByMonth, meiMonthlyDas: dasByMonth.get(referenceMonth) ?? null, dailyRevenue, untilDay, historyMonths })
  }
}
