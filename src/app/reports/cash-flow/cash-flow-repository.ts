import { MovementDirection, MovementStatus, RecordStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { CashFlowMovement } from '../shared/cash-date'

/**
 * As três consultas do Fluxo de Caixa (spec, "Consultas"). Devolve linhas e
 * agregados crus; a regra é toda do `cash-flow-metrics`. TODA consulta filtra
 * `restaurantId` — num agregado, o vazamento entre tenants vira um número
 * maior no gráfico e ninguém percebe (design 1.1).
 */
export class CashFlowRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /**
   * Pendentes com data de caixa até o fim do horizonte (vencidas de qualquer
   * data incluídas) + liquidadas com data de caixa desde `realizedFrom`. A data
   * de caixa da liquidada é `settledAt ?? dueDate ?? date`, por isso o `$or`
   * por presença de campo em vez de `$expr` — cada ramo usa índice.
   */
  async findWindowMovements (ctx: RequestContext, w: { realizedFrom: Date; projectionEnd: Date }): Promise<CashFlowMovement[]> {
    const docs = await this.db(ctx).collection('financial_movements').find(
      {
        restaurantId: ctx.restaurantId,
        $or: [
          { status: MovementStatus.Pending, dueDate: { $lt: w.projectionEnd } },
          { status: MovementStatus.Pending, dueDate: { $exists: false }, date: { $lt: w.projectionEnd } },
          { status: MovementStatus.Settled, settledAt: { $gte: w.realizedFrom } },
          { status: MovementStatus.Settled, settledAt: { $exists: false }, dueDate: { $gte: w.realizedFrom } },
          { status: MovementStatus.Settled, settledAt: { $exists: false }, dueDate: { $exists: false }, date: { $gte: w.realizedFrom } },
        ],
      },
      { projection: { title: 1, category: 1, direction: 1, status: 1, date: 1, dueDate: 1, settledAt: 1, grossValue: 1, netValue: 1 } },
    ).toArray()

    return docs.map((d) => ({
      id: String(d._id),
      title: d.title,
      category: { _id: String(d.category?._id), name: d.category?.name },
      direction: d.direction,
      status: d.status,
      date: d.date,
      dueDate: d.dueDate ?? undefined,
      settledAt: d.settledAt ?? undefined,
      grossValue: decimalToNumber(d.grossValue),
      netValue: decimalToNumber(d.netValue),
    }))
  }

  /** Σ saídas liquidadas com data de caixa em [from, to) + a primeira movimentação do restaurante. */
  async outflowHistory (ctx: RequestContext, w: { from: Date; to: Date }): Promise<{ total: number; firstMovementAt: Date | null }> {
    const movements = this.db(ctx).collection('financial_movements')
    const [agg] = await movements.aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: MovementStatus.Settled, direction: MovementDirection.Out } },
      { $addFields: { cashAt: { $ifNull: ['$settledAt', { $ifNull: ['$dueDate', '$date'] }] } } },
      { $match: { cashAt: { $gte: w.from, $lt: w.to } } },
      { $group: { _id: null, total: { $sum: '$grossValue' } } },
    ]).toArray()

    const first = await movements
      .find({ restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled } }, { projection: { date: 1 } })
      .sort({ date: 1 })
      .limit(1)
      .next()

    return { total: decimalToNumber(agg?.total), firstMovementAt: first?.date ?? null }
  }

  /** Σ availableBalance das contas ATIVAS (conta encerrada não é caixa). */
  async cashToday (ctx: RequestContext): Promise<number> {
    const [agg] = await this.db(ctx).collection('financial_accounts').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: RecordStatus.Active } },
      { $group: { _id: null, total: { $sum: '$availableBalance' } } },
    ]).toArray()
    return decimalToNumber(agg?.total)
  }
}
