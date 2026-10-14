import { CashFlowReport } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addDaysToDay, startOfLocalDay, toLocalDay } from '../../shared/period'
import { CashFlowRepository } from '../cash-flow-repository'
import { OUTFLOW_HISTORY_DAYS, REALIZED_DAYS, computeCashFlow } from '../cash-flow-metrics'

export const DEFAULT_HORIZON = 30

/**
 * Fluxo de Caixa (MIN-94): resolve "hoje" no fuso dos relatórios, busca as
 * linhas e agregados e entrega à regra pura. Read-only. O relógio é injetável
 * para teste.
 */
export class CashFlowQuery {
  constructor (
    private readonly repo: CashFlowRepository = new CashFlowRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, horizon: number = DEFAULT_HORIZON): Promise<CashFlowReport> {
    const today = toLocalDay(this.clock())

    const [movements, history, cashToday, accountNames] = await Promise.all([
      this.repo.findWindowMovements(ctx, {
        realizedFrom: startOfLocalDay(addDaysToDay(today, -REALIZED_DAYS)),
        projectionEnd: startOfLocalDay(addDaysToDay(today, horizon + 1)),
      }),
      this.repo.outflowHistory(ctx, {
        from: startOfLocalDay(addDaysToDay(today, -OUTFLOW_HISTORY_DAYS)),
        to: startOfLocalDay(today),
      }),
      this.repo.cashToday(ctx),
      this.repo.accountNames(ctx),
    ])

    return computeCashFlow({
      today,
      horizon,
      cashToday,
      movements,
      accountNames,
      outflowHistory: {
        total: history.total,
        firstMovementDay: history.firstMovementAt ? toLocalDay(history.firstMovementAt) : null,
      },
    })
  }
}
