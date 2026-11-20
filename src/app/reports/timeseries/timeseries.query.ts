import { TaxRegime } from 'mintly-lib'
import type { TimeseriesReport } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { addMonths, toLocalDay } from '../shared/period'
import { RestaurantRepository } from '../../restaurant/restaurant-repository'
import { TaxRepository } from '../../tax/tax-repository'
import { TaxSettingsRepository } from '../../tax/tax-settings-repository'
import { ResultRepository } from '../result/result-repository'
import { monthTax } from '../result/result-metrics'
import { TimeseriesRepository } from './timeseries-repository'
import { buckets, computeTimeseries, parseTimeseriesQuery } from './timeseries-metrics'

/** GET /reports/timeseries — série por dia, semana ou mês (P.3). Read-only. */
export class TimeseriesQuery {
  constructor (
    private readonly repo: TimeseriesRepository = new TimeseriesRepository(),
    private readonly result: ResultRepository = new ResultRepository(),
    private readonly restaurants: RestaurantRepository = new RestaurantRepository(),
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly settings: TaxSettingsRepository = new TaxSettingsRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, raw: { granularity?: unknown, points?: unknown, compare?: unknown }): Promise<TimeseriesReport> {
    const { granularity, points, previousYear } = parseTimeseriesQuery(raw)
    const today = toLocalDay(this.clock())
    const bs = buckets(granularity, points, today)
    // Com o ano anterior, a janela começa 12 meses antes do primeiro balde.
    const from = previousYear ? `${addMonths(bs[0].start.slice(0, 7), -12)}-01` : bs[0].start
    const to = today
    const months: string[] = []
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) months.push(m)

    const restaurant = await this.restaurants.findMine(ctx)
    const regime: TaxRegime | null = restaurant.taxRegime ?? null
    const [rows, categories, firstMonth, revenueByMonth, dasByMonth] = await Promise.all([
      this.repo.dailyTotals(ctx, { from, to }),
      this.result.categories(ctx),
      this.taxRepo.firstMovementMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(months[0], -13), to: months[months.length - 1] }),
      regime === TaxRegime.Mei
        ? Promise.all(months.map(async (m) => [m, await this.settings.meiMonthlyDasAt(m)] as const)).then((e) => new Map<string, number | null>(e))
        : Promise.resolve(new Map<string, number | null>()),
    ])
    const systemIds = [...categories.values()].filter((c) => c.systemKey).map((c) => c.id)
    const cash = await this.repo.dailyCash(ctx, { from, to }, systemIds)
    const taxByMonth = new Map(months.map((m) => [m, monthTax({ regime, month: m, firstMonth, revenueByMonth, meiMonthlyDas: dasByMonth.get(m) ?? null })]))

    return computeTimeseries({ granularity, points, today, rows, cash, categories, taxByMonth, revenueByMonth, previousYear })
  }
}
