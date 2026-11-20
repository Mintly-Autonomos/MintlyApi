import { TIMESERIES_MAX_DAYS, TIMESERIES_MAX_MONTHS, TIMESERIES_MAX_WEEKS } from 'mintly-lib'
import type { TimeseriesGranularity, TimeseriesPoint, TimeseriesReport } from 'mintly-lib'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { addDaysToDay, addMonths } from '../shared/period'
import { CategoryInfo, MonthTax, MonthlyTotalRow, aggregateMonth, buildLines } from '../result/result-metrics'

/**
 * Série por dia, semana ou mês (P.3 / relatório 12.4). Pura (testada sem banco).
 *
 * Reaproveita a classificação do Resultado: as linhas por DIA vêm com \`month\` = o dia, e cada balde é um
 * "mês" do \`aggregateMonth\` — o mesmo CMV, despesas, não operacional, transferência e imposto do DRE.
 * O imposto do mês: alíquota (Simples) vale para a receita do balde; valor fixo (DAS-MEI configurado) é repartido
 * pela receita do balde no mês; DAS pago (MEI sem valor) entra no balde em que foi pago.
 */

export interface DailyCashRow {
  /** "AAAA-MM-DD" do dinheiro (liquidado). */
  day: string
  direction: 'in' | 'out'
  value: number
}

export const DEFAULT_POINTS: Record<TimeseriesGranularity, number> = { day: 30, week: 12, month: 12 }
const MAX_POINTS: Record<TimeseriesGranularity, number> = { day: TIMESERIES_MAX_DAYS, week: TIMESERIES_MAX_WEEKS, month: TIMESERIES_MAX_MONTHS }

export function parseTimeseriesQuery (q: { granularity?: unknown, points?: unknown, compare?: unknown }): { granularity: TimeseriesGranularity, points: number, previousYear: boolean } {
  const g = q.granularity ?? 'month'
  if (g !== 'day' && g !== 'week' && g !== 'month') throw new ValidationError('granularity inválida: use day, week ou month.')
  const n = q.points == null || q.points === '' ? DEFAULT_POINTS[g] : Number(q.points)
  if (!Number.isInteger(n) || n < 1 || n > MAX_POINTS[g]) throw new ValidationError(`points inválido: de 1 a ${MAX_POINTS[g]} para ${g}.`)
  if (q.compare != null && q.compare !== '' && q.compare !== 'previousYear') throw new ValidationError('compare inválido: use previousYear.')
  if (q.compare === 'previousYear' && g !== 'month') throw new ValidationError('compare=previousYear só vale para granularity=month.')
  return { granularity: g, points: n, previousYear: q.compare === 'previousYear' }
}

/** Segunda-feira da semana do dia "AAAA-MM-DD". */
export function weekStart (day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysToDay(day, -((dow + 6) % 7))
}

const lastDayOfMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Baldes até \`today\` (inclusive): [início, fim] em dias. Mês e semana atuais vão até hoje. */
export function buckets (granularity: TimeseriesGranularity, points: number, today: string): Array<{ key: string, start: string, end: string }> {
  const out: Array<{ key: string, start: string, end: string }> = []
  for (let i = points - 1; i >= 0; i--) {
    if (granularity === 'day') {
      const d = addDaysToDay(today, -i)
      out.push({ key: d, start: d, end: d })
    } else if (granularity === 'week') {
      const s = addDaysToDay(weekStart(today), -7 * i)
      const e = addDaysToDay(s, 6)
      out.push({ key: s, start: s, end: e < today ? e : today })
    } else {
      const m = addMonths(today.slice(0, 7), -i)
      const e = lastDayOfMonth(m)
      out.push({ key: m, start: `${m}-01`, end: e < today ? e : today })
    }
  }
  return out
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * \`rows\`: somas por DIA (\`month\` = "AAAA-MM-DD") × direção × categoria, como o \`monthlyTotals\` do Resultado.
 * \`taxByMonth\`: o imposto de cada mês ("AAAA-MM"); \`revenueByMonth\`: a receita do mês inteiro, para repartir o valor fixo.
 */
export function computeTimeseries (input: {
  granularity: TimeseriesGranularity
  points: number
  today: string
  rows: MonthlyTotalRow[]
  cash: DailyCashRow[]
  categories: Map<string, CategoryInfo>
  taxByMonth: Map<string, MonthTax>
  revenueByMonth: Map<string, number>
  previousYear: boolean
}): TimeseriesReport {
  const point = (b: { key: string, start: string, end: string }): TimeseriesPoint => {
    // Linhas do balde, todas com o mesmo "mês" (a chave do balde) para o aggregateMonth.
    const rows = input.rows.filter((r) => r.month >= b.start && r.month <= b.end).map((r) => ({ ...r, month: b.key }))
    const agg = aggregateMonth(rows, b.key, input.categories)
    const month = b.start.slice(0, 7)
    const t = input.taxByMonth.get(month) ?? { effectiveRate: null, fixedAmount: null }
    const monthRevenue = input.revenueByMonth.get(month) ?? 0
    const share = monthRevenue > 0 ? (agg.grossRevenue / 100) / monthRevenue : 0
    const tax: MonthTax = t.fixedAmount != null && input.granularity !== 'month'
      ? { effectiveRate: null, fixedAmount: round(t.fixedAmount * share) }
      : t
    const l = buildLines(agg, tax)
    const cash = input.cash.filter((c) => c.day >= b.start && c.day <= b.end)
    const semCmv = [...agg.opexCategories.values()].reduce((s, c) => s + c.cents, 0) + agg.platformFee + agg.cardFee
    return {
      key: b.key,
      end: b.end,
      revenue: l.grossRevenue,
      cmv: l.cmv,
      expenses: round(semCmv / 100),
      taxes: l.taxes,
      profit: l.netProfit,
      cashIn: round(cash.filter((c) => c.direction === 'in').reduce((s, c) => s + c.value, 0)),
      cashOut: round(cash.filter((c) => c.direction === 'out').reduce((s, c) => s + c.value, 0)),
    }
  }

  const bs = buckets(input.granularity, input.points, input.today)
  const points = bs.map(point)
  const previousYear = input.previousYear && input.granularity === 'month'
    ? bs.map((b) => {
      const m = addMonths(b.key, -12)
      return point({ key: m, start: `${m}-01`, end: lastDayOfMonth(m) })
    })
    : null
  return { granularity: input.granularity, points, previousYear }
}
