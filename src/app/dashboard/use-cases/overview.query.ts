import { OverviewReport } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { ResultQuery } from '../../reports/result/use-cases/result.query'
import { CashFlowQuery } from '../../reports/cash-flow/use-cases/cash-flow.query'
import { ExpensesQuery } from '../../reports/expenses/use-cases/expenses.query'
import { OVERVIEW_HORIZON, computeOverview } from '../overview-metrics'

/**
 * Visão Geral: roda DRE, Fluxo de Caixa (30 dias) e Custos em paralelo, com o
 * MESMO relógio, e entrega à regra pura. Mês inválido/futuro → 400 vindo das
 * próprias consultas. Read-only.
 */
export class OverviewQuery {
  private readonly result: ResultQuery
  private readonly cashFlow: CashFlowQuery
  private readonly expenses: ExpensesQuery

  constructor (private readonly clock: () => Date = () => new Date(), deps: { result?: ResultQuery; cashFlow?: CashFlowQuery; expenses?: ExpensesQuery } = {}) {
    this.result = deps.result ?? new ResultQuery(undefined, undefined, undefined, undefined, clock)
    this.cashFlow = deps.cashFlow ?? new CashFlowQuery(undefined, clock)
    this.expenses = deps.expenses ?? new ExpensesQuery(undefined, undefined, clock)
  }

  async execute (ctx: RequestContext, month?: string): Promise<OverviewReport> {
    const today = this.clock()
    const [result, cashFlow, expenses] = await Promise.all([
      this.result.execute(ctx, month),
      this.cashFlow.execute(ctx, OVERVIEW_HORIZON),
      this.expenses.execute(ctx, month),
    ])
    return computeOverview({ result, cashFlow, expenses, today })
  }
}
