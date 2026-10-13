import { ExpensesReport } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addMonths, parseReferenceMonth } from '../../shared/period'
import { TaxRepository } from '../../../tax/tax-repository'
import { ExpensesRepository } from '../expenses-repository'
import { HISTORY_MONTHS, computeExpenses, parseExpensesChannel } from '../expenses-metrics'

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
    const filter = parseExpensesChannel(channel)
    const [rows, categories, accountNames, firstMonth] = await Promise.all([
      this.repo.monthlyRows(ctx, { from: addMonths(referenceMonth, -(HISTORY_MONTHS - 1)), to: referenceMonth }),
      this.repo.categories(ctx),
      this.repo.accountNames(ctx),
      this.taxRepo.firstMovementMonth(ctx),
    ])
    return computeExpenses({ referenceMonth, channel: filter, rows, categories, accountNames, firstMonth, today: now })
  }
}
