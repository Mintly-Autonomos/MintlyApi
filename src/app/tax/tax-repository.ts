import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { decimalToNumber } from '../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth, toLocalMonth } from '../reports/shared/period'

/**
 * Receita por competência para o RBT12 (MIN-23, sem `daily_sales`): Σ grossValue
 * das ENTRADAS não canceladas, agrupada por mês civil em São Paulo. Pendentes
 * contam — faturamento é competência. Escopado por restaurantId.
 */
export class TaxRepository {
  private movements (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection('financial_movements')
  }

  /** Receita de cada mês em [from, to] (inclusivo). Mês sem receita não aparece. */
  async revenueByMonth (ctx: RequestContext, w: { from: string; to: string }): Promise<Map<string, number>> {
    const rows = await this.movements(ctx).aggregate([
      {
        $match: {
          restaurantId: ctx.restaurantId,
          direction: MovementDirection.In,
          status: { $ne: MovementStatus.Cancelled },
          date: { $gte: startOfLocalMonth(w.from), $lt: startOfLocalMonth(addMonths(w.to, 1)) },
        },
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } }, total: { $sum: '$grossValue' } } },
    ]).toArray()
    return new Map(rows.map((r) => [String(r._id), decimalToNumber(r.total)]))
  }

  /** Mês da primeira movimentação não cancelada do restaurante (qualquer direção). */
  async firstMovementMonth (ctx: RequestContext): Promise<string | null> {
    const first = await this.movements(ctx)
      .find({ restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled } }, { projection: { date: 1 } })
      .sort({ date: 1 })
      .limit(1)
      .next()
    return first?.date ? toLocalMonth(first.date) : null
  }
}
