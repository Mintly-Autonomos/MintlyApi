import { ExpenseSubitem, ExpensesAnomalyRule } from 'mintly-lib'
import { toCents } from '../../../core/money/money'
import { toLocalDay } from '../shared/period'

/**
 * Custos & Despesas, fatia B (spec 20261013/custos-despesas-b.md) — regras puras
 * de anomalia, projeção e ordem dos subitens.
 *
 * Limiares de anomalia: palpite do design a partir das prints (Embalagens +66%,
 * Gás +56%), ainda NÃO validado pelo negócio — pendência N4. Ajuste aqui.
 */
export const ANOMALY_MIN_PCT_ABOVE = 0.5
export const ANOMALY_MIN_EXCESS = 100
/** Com 1 mês só de base, uma compra pontual vira alerta falso (decisão B4). */
export const ANOMALY_MIN_HISTORY_MONTHS = 2
export const ANOMALY_RULE: ExpensesAnomalyRule = {
  minPctAbove: ANOMALY_MIN_PCT_ABOVE,
  minExcess: ANOMALY_MIN_EXCESS,
  minHistoryMonths: ANOMALY_MIN_HISTORY_MONTHS,
}

export const NO_SUBITEM_KEY = 'none'
export const NO_SUBITEM_NAME = 'Sem subitem'

/** Valor e média em centavos. Média 0 (gasto novo) não tem com o que comparar. */
export function isAnomaly (amountCents: number, averageCents: number | null, eligibleMonths: number): boolean {
  if (eligibleMonths < ANOMALY_MIN_HISTORY_MONTHS || averageCents == null || averageCents <= 0) return false
  const excess = amountCents - averageCents
  return excess >= toCents(ANOMALY_MIN_EXCESS) && excess / averageCents >= ANOMALY_MIN_PCT_ABOVE
}

/** Dias do mês AAAA-MM (calendário puro). */
export function daysInMonth (month: string): number {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year, m, 0)).getUTCDate()
}

/** Só quando `month` é o mês de hoje em SP; `elapsedDays` conta o dia de hoje. */
export function projectionWindow (month: string, today: Date): { elapsedDays: number; daysInMonth: number } | null {
  const day = toLocalDay(today)
  if (day.slice(0, 7) !== month) return null
  return { elapsedDays: Number(day.slice(8, 10)), daysInMonth: daysInMonth(month) }
}

/** Projeção linear em centavos, arredondada. */
export function project (cents: number, w: { elapsedDays: number; daysInMonth: number }): number {
  return Math.round(cents * w.daysInMonth / w.elapsedDays)
}

/** Valor desc., depois nome; "Sem subitem" sempre por último. */
export function sortSubitems (list: ExpenseSubitem[]): ExpenseSubitem[] {
  const last = (s: ExpenseSubitem) => (s.key === NO_SUBITEM_KEY ? 1 : 0)
  return [...list].sort((a, b) => last(a) - last(b) || b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))
}
