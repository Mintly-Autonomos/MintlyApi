import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { REPORT_TIME_ZONE, addDaysToDay, startOfLocalDay } from '../shared/period'
import { cardMachineAccountIds } from '../shared/card-machines'
import { MonthlyTotalRow } from '../result/result-metrics'
import { DailyCashRow } from './timeseries-metrics'

/** Consultas da série (P.3): por DIA no fuso de SP, sem canceladas, sempre com o restaurantId do contexto. */
export class TimeseriesRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /** Σ bruto e Σ taxa por dia × direção × categoria, pela data do lançamento (competência), em [from, to]. */
  async dailyTotals (ctx: RequestContext, w: { from: string, to: string }): Promise<MonthlyTotalRow[]> {
    const cards = await cardMachineAccountIds(this.db(ctx), ctx.restaurantId)
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled }, date: { $gte: startOfLocalDay(w.from), $lt: startOfLocalDay(addDaysToDay(w.to, 1)) } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIME_ZONE } },
            direction: '$direction',
            categoryId: '$category._id',
            cardMachine: cards.length > 0 ? { $in: ['$account._id', cards] } : { $literal: false },
          },
          gross: { $sum: '$grossValue' },
          fee: { $sum: '$feeValue' },
          categoryName: { $first: '$category.name' },
        },
      },
    ]).toArray()
    return rows.map((r) => ({
      month: r._id.day,
      direction: r._id.direction === MovementDirection.In ? 'in' : 'out',
      categoryId: String(r._id.categoryId),
      categoryName: r.categoryName ?? '',
      ...(r._id.cardMachine ? { cardMachine: true } : {}),
      gross: decimalToNumber(r.gross),
      fee: decimalToNumber(r.fee),
    }))
  }

  /**
   * Dinheiro que entrou e saiu por dia (liquidado), pela data de caixa \`settledAt ?? dueDate ?? date\`, como o
   * Fluxo de caixa. Entrada pelo líquido (depois da taxa), saída pelo bruto. Sem transferência entre contas nem
   * saldo inicial (categorias de sistema).
   */
  async dailyCash (ctx: RequestContext, w: { from: string, to: string }, systemCategoryIds: string[]): Promise<DailyCashRow[]> {
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: MovementStatus.Settled } },
      { $addFields: { cashDate: { $ifNull: ['$settledAt', { $ifNull: ['$dueDate', '$date'] }] } } },
      { $match: { cashDate: { $gte: startOfLocalDay(w.from), $lt: startOfLocalDay(addDaysToDay(w.to, 1)) } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$cashDate', timezone: REPORT_TIME_ZONE } },
            direction: '$direction',
            categoryId: '$category._id',
          },
          inValue: { $sum: '$netValue' },
          outValue: { $sum: '$grossValue' },
        },
      },
    ]).toArray()
    const system = new Set(systemCategoryIds)
    return rows
      .filter((r) => !system.has(String(r._id.categoryId)))
      .map((r) => {
        const isIn = r._id.direction === MovementDirection.In
        return { day: r._id.day, direction: isIn ? 'in' as const : 'out' as const, value: decimalToNumber(isIn ? r.inValue : r.outValue) }
      })
  }
}
