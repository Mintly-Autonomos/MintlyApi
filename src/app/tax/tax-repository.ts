import { DreGroup, MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { decimalToNumber } from '../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth, toLocalMonth } from '../reports/shared/period'
import { excludeCategories, nonOperatingCategoryIds } from '../reports/shared/non-operating'

/**
 * Receita por competência para o RBT12 (MIN-23, sem `daily_sales`): Σ grossValue
 * das ENTRADAS não canceladas, agrupada por mês civil em São Paulo. Pendentes
 * contam — faturamento é competência. Entradas "Não operacional" (empréstimo,
 * aporte, saldo inicial) não são faturamento e ficam fora. Escopado por restaurantId.
 */
export class TaxRepository {
  private movements (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection('financial_movements')
  }

  /** Receita de cada mês em [from, to] (inclusivo). Mês sem receita não aparece. */
  async revenueByMonth (ctx: RequestContext, w: { from: string; to: string }): Promise<Map<string, number>> {
    const nonOperating = await nonOperatingCategoryIds(MongoDBConnection.getInstance().getDatabase(ctx.env), ctx.restaurantId)
    const rows = await this.movements(ctx).aggregate([
      {
        $match: {
          restaurantId: ctx.restaurantId,
          direction: MovementDirection.In,
          status: { $ne: MovementStatus.Cancelled },
          date: { $gte: startOfLocalMonth(w.from), $lt: startOfLocalMonth(addMonths(w.to, 1)) },
          ...excludeCategories(nonOperating),
        },
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } }, total: { $sum: '$grossValue' } } },
    ]).toArray()
    return new Map(rows.map((r) => [String(r._id), decimalToNumber(r.total)]))
  }

  /**
   * Primeiro mês de atividade para o imposto (reteste 22/11, T2): o mês da primeira VENDA não cancelada (entrada
   * operacional). Antes era a primeira movimentação de qualquer tipo: uma despesa lançada antes da primeira venda
   * virava um "mês de atividade" com receita zero. O 1º mês com venda saía com RBT12 0 (4%, em vez da receita do mês
   * × 12, CGSN 140/2018, art. 22 §2º) e do 2º ao 12º a média dividia por um mês a mais (§3º).
   */
  async firstRevenueMonth (ctx: RequestContext): Promise<string | null> {
    const nonOperating = await nonOperatingCategoryIds(MongoDBConnection.getInstance().getDatabase(ctx.env), ctx.restaurantId)
    const first = await this.movements(ctx)
      .find(
        { restaurantId: ctx.restaurantId, direction: MovementDirection.In, status: { $ne: MovementStatus.Cancelled }, ...excludeCategories(nonOperating) },
        { projection: { date: 1 } },
      )
      .sort({ date: 1 })
      .limit(1)
      .next()
    return first?.date ? toLocalMonth(first.date) : null
  }

  /**
   * Cada pagamento em categoria de imposto (DAS) com a data em [from, to] (meses inclusivos), não cancelado. É a base
   * do DAS típico do MEI sem o valor configurado (`typicalDas`).
   */
  async taxPayments (ctx: RequestContext, w: { from: string; to: string }): Promise<number[]> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    const cats = await db.collection('financial_categories')
      .find({ restaurantId: ctx.restaurantId, dreGroup: DreGroup.Tax }, { projection: { _id: 1 } })
      .toArray()
    if (cats.length === 0) return []
    const rows = await this.movements(ctx)
      .find({
        restaurantId: ctx.restaurantId,
        direction: MovementDirection.Out,
        status: { $ne: MovementStatus.Cancelled },
        'category._id': { $in: cats.map((c) => String(c._id)) },
        date: { $gte: startOfLocalMonth(w.from), $lt: startOfLocalMonth(addMonths(w.to, 1)) },
      }, { projection: { grossValue: 1 } })
      .toArray()
    return rows.map((r) => decimalToNumber(r.grossValue))
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
