import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth } from '../shared/period'
import { CategoryInfo, MonthlyTotalRow } from './result-metrics'
import { sumUntilDay } from '../shared/until-day'

/**
 * Consultas do Resultado (spec, "Consultas"). Somas por competência no fuso de SP,
 * sem canceladas, sempre com restaurantId do contexto.
 */
export class ResultRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  private monthRange (from: string, to: string) {
    return { $gte: startOfLocalMonth(from), $lt: startOfLocalMonth(addMonths(to, 1)) }
  }

  /**
   * Σ grossValue e Σ feeValue por mês × direção × categoria em [from, to]. Com
   * `untilDay` (ajuste A1), também as somas até esse dia de cada mês.
   */
  async monthlyTotals (ctx: RequestContext, w: { from: string; to: string }, untilDay: number | null = null): Promise<MonthlyTotalRow[]> {
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled }, date: this.monthRange(w.from, w.to) } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } },
            direction: '$direction',
            categoryId: '$category._id',
          },
          gross: { $sum: '$grossValue' },
          fee: { $sum: '$feeValue' },
          categoryName: { $first: '$category.name' },
          ...(untilDay != null ? { grossUntil: sumUntilDay('$grossValue', untilDay), feeUntil: sumUntilDay('$feeValue', untilDay) } : {}),
        },
      },
    ]).toArray()

    return rows.map((r) => ({
      month: r._id.month,
      direction: r._id.direction === MovementDirection.In ? 'in' : 'out',
      categoryId: String(r._id.categoryId),
      categoryName: r.categoryName ?? '',
      gross: decimalToNumber(r.gross),
      fee: decimalToNumber(r.fee),
      ...(untilDay != null ? { grossUntil: decimalToNumber(r.grossUntil), feeUntil: decimalToNumber(r.feeUntil) } : {}),
    }))
  }

  /** Todas as categorias do restaurante (inativa também pode ter lançamento antigo). */
  async categories (ctx: RequestContext): Promise<Map<string, CategoryInfo>> {
    const docs = await this.db(ctx).collection('financial_categories')
      .find({ restaurantId: ctx.restaurantId }, { projection: { name: 1, dreGroup: 1, behavior: 1 } })
      .toArray()
    return new Map(docs.map((d) => [String(d._id), { id: String(d._id), name: d.name, dreGroup: d.dreGroup, behavior: d.behavior }]))
  }

  /** Receita bruta por dia (AAAA-MM-DD) do mês. */
  async dailyRevenue (ctx: RequestContext, month: string): Promise<Map<string, number>> {
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, direction: MovementDirection.In, status: { $ne: MovementStatus.Cancelled }, date: this.monthRange(month, month) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIME_ZONE } }, total: { $sum: '$grossValue' } } },
    ]).toArray()
    return new Map(rows.map((r) => [String(r._id), decimalToNumber(r.total)]))
  }
}
