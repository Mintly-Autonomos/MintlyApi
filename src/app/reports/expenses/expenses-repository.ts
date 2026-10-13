import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth } from '../shared/period'
import { ExpenseCategoryInfo, ExpenseRow } from './expenses-metrics'

/**
 * Consultas de Custos & Despesas: por competência no fuso de SP, sem canceladas,
 * sempre com restaurantId do contexto. O canal efetivo é resolvido depois, em TS.
 */
export class ExpensesRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /** Σ grossValue e Σ feeValue por mês × direção × categoria × canal gravado × conta, em [from, to]. */
  /**
   * `after` (opcional): instante a partir do qual o lançamento ainda não aconteceu
   * (amanhã 00h em SP) — separa `grossAfter`/`feeAfter` para a projeção (fatia 7).
   */
  async monthlyRows (ctx: RequestContext, w: { from: string; to: string }, after?: Date): Promise<ExpenseRow[]> {
    const afterOnly = (field: string) => (after ? { $cond: [{ $gte: ['$date', after] }, { $ifNull: [field, 0] }, 0] } : 0)
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled }, date: { $gte: startOfLocalMonth(w.from), $lt: startOfLocalMonth(addMonths(w.to, 1)) } } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } },
            direction: '$direction',
            categoryId: '$category._id',
            channel: { $ifNull: ['$channel', null] },
            accountId: '$account._id',
            accountType: '$account.type',
            // Fatia 7. $ifNull junta ausente e null no mesmo grupo (lançamento antigo sem o campo).
            subcategoryId: { $ifNull: ['$subcategory._id', null] },
          },
          gross: { $sum: '$grossValue' },
          fee: { $sum: '$feeValue' },
          grossAfter: { $sum: afterOnly('$grossValue') },
          feeAfter: { $sum: afterOnly('$feeValue') },
          categoryName: { $first: '$category.name' },
          accountName: { $first: '$account.name' },
          subcategoryName: { $first: '$subcategory.name' },
        },
      },
    ]).toArray()

    return rows.map((r) => ({
      month: r._id.month,
      direction: r._id.direction === MovementDirection.In ? 'in' : 'out',
      categoryId: String(r._id.categoryId),
      categoryName: r.categoryName ?? '',
      accountId: String(r._id.accountId),
      accountName: r.accountName ?? '',
      accountType: r._id.accountType ?? '',
      channel: r._id.channel ?? null,
      subcategoryId: r._id.subcategoryId ?? null,
      subcategoryName: r.subcategoryName ?? null,
      gross: decimalToNumber(r.gross),
      fee: decimalToNumber(r.fee),
      grossAfter: decimalToNumber(r.grossAfter),
      feeAfter: decimalToNumber(r.feeAfter),
    }))
  }

  /** Todas as categorias do restaurante (inativa também pode ter lançamento antigo). */
  async categories (ctx: RequestContext): Promise<Map<string, ExpenseCategoryInfo>> {
    const docs = await this.db(ctx).collection('financial_categories')
      .find({ restaurantId: ctx.restaurantId }, { projection: { name: 1, dreGroup: 1, behavior: 1, subcategories: 1 } })
      .toArray()
    return new Map(docs.map((d) => [String(d._id), {
      name: d.name,
      behavior: d.behavior,
      dreGroup: d.dreGroup,
      subcategories: (d.subcategories ?? []).map((s: any) => ({ _id: s._id, name: s.name })),
    }]))
  }

  /** Nome atual das contas (a linha da taxa usa o nome vivo). */
  async accountNames (ctx: RequestContext): Promise<Map<string, string>> {
    const docs = await this.db(ctx).collection('financial_accounts')
      .find({ restaurantId: ctx.restaurantId }, { projection: { name: 1 } })
      .toArray()
    return new Map(docs.map((d) => [String(d._id), d.name]))
  }
}
