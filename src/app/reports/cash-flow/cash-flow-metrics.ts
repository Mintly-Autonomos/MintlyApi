import { CashFlowWeek, DailyPoint, MovementDirection, MovementStatus } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { addDaysToDay } from '../shared/period'
import { CashFlowMovement, cashAmount, cashDay, isOverdue } from '../shared/cash-date'

/**
 * Regra pura do Fluxo de Caixa (spec 20261012, "Regra de cálculo"). Sem Mongo:
 * recebe as linhas que o repositório trouxe e devolve os números. Toda soma é
 * em CENTAVOS inteiros — float acumulado ao longo de 365 dias erra centavo.
 */

/** Margem de segurança do dia crítico, em dias de despesa média. Palpite — N13. */
export const SAFETY_DAYS = 7
/** Tamanho da série realizada (dias antes de hoje). */
export const REALIZED_DAYS = 7
/** Janela da média de saída que alimenta a margem de segurança. */
export const OUTFLOW_HISTORY_DAYS = 90
/** Tamanho do bloco de "Entradas × Saídas". */
export const WEEK_DAYS = 7

interface DayFlows { inflows: number; outflows: number }
const NO_FLOWS: DayFlows = { inflows: 0, outflows: 0 }

const isPending = (m: CashFlowMovement) => m.status === MovementStatus.Pending
export const isSettled = (m: CashFlowMovement) => m.status === MovementStatus.Settled

/** Entradas e saídas (centavos) por data de caixa. */
export function flowsByDay (movements: CashFlowMovement[], today: string): Map<string, DayFlows> {
  const flows = new Map<string, DayFlows>()
  for (const m of movements) {
    const day = cashDay(m, today)
    const current = flows.get(day) ?? { inflows: 0, outflows: 0 }
    const cents = toCents(cashAmount(m))
    if (m.direction === MovementDirection.In) current.inflows += cents
    else current.outflows += cents
    flows.set(day, current)
  }
  return flows
}

function point (date: string, balanceCents: number, f: DayFlows): DailyPoint {
  return { date, balance: fromCents(balanceCents), inflows: fromCents(f.inflows), outflows: fromCents(f.outflows) }
}

/**
 * Projeção diária: saldo no FIM de cada dia, de hoje até hoje + horizonte.
 * Hoje já inclui as vencidas (F1). O que vence depois do horizonte não entra
 * porque o laço termina antes.
 */
export function buildProjection (p: { today: string; horizon: number; cashToday: number; movements: CashFlowMovement[] }): DailyPoint[] {
  const flows = flowsByDay(p.movements.filter(isPending), p.today)
  const points: DailyPoint[] = []
  let balance = toCents(p.cashToday)
  for (let i = 0; i <= p.horizon; i++) {
    const date = addDaysToDay(p.today, i)
    const f = flows.get(date) ?? NO_FLOWS
    balance += f.inflows - f.outflows
    points.push(point(date, balance, f))
  }
  return points
}

/**
 * A receber / a pagar até o fim do horizonte, vencidas incluídas — senão
 * `projectedBalance` não fecharia com o último ponto da projeção. O bloco
 * `overdue` separa as vencidas para o destaque da tela (F2).
 */
export function summarizePending (movements: CashFlowMovement[], today: string, horizon: number) {
  const end = addDaysToDay(today, horizon)
  let receivable = 0
  let payable = 0
  let overdueCount = 0
  let overdueIn = 0
  let overdueOut = 0

  for (const m of movements.filter(isPending)) {
    if (cashDay(m, today) > end) continue
    const cents = toCents(cashAmount(m))
    const isIn = m.direction === MovementDirection.In
    if (isIn) receivable += cents
    else payable += cents
    if (isOverdue(m, today)) {
      overdueCount++
      if (isIn) overdueIn += cents
      else overdueOut += cents
    }
  }

  return {
    receivable: fromCents(receivable),
    payable: fromCents(payable),
    overdue: { count: overdueCount, receivable: fromCents(overdueIn), payable: fromCents(overdueOut) },
  }
}

/** Menor saldo da série; empate fica com o primeiro dia. `points` nunca é vazio (horizon ≥ 1). */
export function lowestPoint (points: DailyPoint[]): { date: string; balance: number } {
  let low = points[0]
  for (const p of points) {
    if (p.balance < low.balance) low = p
  }
  return { date: low.date, balance: low.balance }
}

/** Blocos de 7 dias a partir de hoje ("Sem 1" = hoje até hoje + 6). */
export function groupWeeks (points: DailyPoint[]): CashFlowWeek[] {
  const weeks: CashFlowWeek[] = []
  for (let i = 0; i < points.length; i += WEEK_DAYS) {
    const chunk = points.slice(i, i + WEEK_DAYS)
    weeks.push({
      from: chunk[0].date,
      to: chunk[chunk.length - 1].date,
      inflows: fromCents(chunk.reduce((sum, p) => sum + toCents(p.inflows), 0)),
      outflows: fromCents(chunk.reduce((sum, p) => sum + toCents(p.outflows), 0)),
    })
  }
  return weeks
}
