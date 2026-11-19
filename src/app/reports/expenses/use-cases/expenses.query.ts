import { ExpensesReport } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addDaysToDay, addMonths, parseReferenceMonth, startOfLocalDay, toLocalDay, comparisonUntilDay } from '../../shared/period'
import { TaxRepository } from '../../../tax/tax-repository'
import { ExpensesRepository } from '../expenses-repository'
import { HISTORY_MONTHS, ANOMALY_BASE_MONTHS, computeExpenses, parseExpensesChannel } from '../expenses-metrics'

/** Custos & Despesas: resolve mês e canal, lê a janela de 6 meses e entrega à regra pura. Read-only. */
export class ExpensesQuery {
  constructor (
    private readonly repo: ExpensesRepository = new ExpensesRepository(),
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, month?: string, channel?: unknown): Promise<ExpensesReport> {
    const now = this.clock()
    const referenceMonth = parseReferenceMonth(month, now)
    const untilDay = comparisonUntilDay(referenceMonth, now)
    const filter = parseExpensesChannel(channel)
    const [rows, categories, accountNames, firstMonth, cardMachines] = await Promise.all([
      // 13 meses: o histórico exibido é de 6, mas a base do alerta de gasto fora do normal olha até 12 meses.
      this.repo.monthlyRows(ctx, { from: addMonths(referenceMonth, -Math.max(HISTORY_MONTHS - 1, ANOMALY_BASE_MONTHS)), to: referenceMonth }, startOfLocalDay(addDaysToDay(toLocalDay(now), 1)), untilDay),
      this.repo.categories(ctx),
      this.repo.accountNames(ctx),
      this.taxRepo.firstMovementMonth(ctx),
      this.repo.cardMachines(ctx),
    ])
    return computeExpenses({ referenceMonth, channel: filter, rows, categories, accountNames, cardMachines, firstMonth, today: now, untilDay })
  }
}
