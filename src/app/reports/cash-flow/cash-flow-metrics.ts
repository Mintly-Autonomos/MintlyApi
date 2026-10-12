import { CashFlowReport, CashFlowWeek, CriticalDayInsight, DailyPoint, DueItem, MovementDirection, MovementStatus } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { addDaysToDay, diffDays, toLocalDay } from '../shared/period'
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

/**
 * Série realizada: saldo no fim de cada um dos 7 dias antes de hoje,
 * reconstruído para TRÁS a partir do caixa de hoje desfazendo o que liquidou
 * em cada dia. Usa todas as liquidadas, inclusive à vista. Limitação: edição
 * retroativa reescreve o passado desenhado (N12).
 */
export function buildRealized (p: { today: string; cashToday: number; movements: CashFlowMovement[] }): DailyPoint[] {
  const flows = flowsByDay(p.movements.filter(isSettled), p.today)
  const todayFlows = flows.get(p.today) ?? NO_FLOWS
  let balance = toCents(p.cashToday) - (todayFlows.inflows - todayFlows.outflows)

  const points: DailyPoint[] = []
  for (let i = 1; i <= REALIZED_DAYS; i++) {
    const date = addDaysToDay(p.today, -i)
    const f = flows.get(date) ?? NO_FLOWS
    points.unshift(point(date, balance, f))
    balance -= f.inflows - f.outflows
  }
  return points
}

/**
 * Margem de segurança do dia crítico (F3): SAFETY_DAYS dias de despesa média.
 * O divisor conta desde a primeira movimentação do restaurante (no máximo 90):
 * dividir sempre por 90 faria um restaurante com 10 dias de uso nunca ver
 * alerta. Sem histórico, o limiar é 0 e só saldo negativo dispara.
 */
export function safetyThreshold (p: { today: string; outflowTotal: number; firstMovementDay: string | null }) {
  if (p.firstMovementDay == null) {
    return { value: 0, days: SAFETY_DAYS, avgDailyOutflow: 0 }
  }
  const historyDays = Math.max(1, Math.min(OUTFLOW_HISTORY_DAYS, diffDays(p.firstMovementDay, p.today)))
  const avgCents = Math.round(toCents(p.outflowTotal) / historyDays)
  return { value: fromCents(avgCents * SAFETY_DAYS), days: SAFETY_DAYS, avgDailyOutflow: fromCents(avgCents) }
}

/** Primeiro dia da projeção com saldo ABAIXO do limiar (igual ao limiar não é crítico). */
export function criticalDayInsight (points: DailyPoint[], threshold: number): CriticalDayInsight | null {
  const hit = points.find((p) => p.balance < threshold)
  if (!hit) return null
  return { kind: 'criticalDay', severity: 'warning', date: hit.date, balance: hit.balance, threshold }
}

/**
 * Lista de vencimentos: só movimentação COM vencimento — venda à vista não
 * entra, senão a lista vira extrato. Janela: pendentes até o fim do horizonte
 * (vencidas incluídas) + liquidadas nos últimos REALIZED_DAYS dias. Filtros e
 * agrupamento por dia são do front.
 */
export function buildDueItems (movements: CashFlowMovement[], today: string, horizon: number): DueItem[] {
  const end = addDaysToDay(today, horizon)
  const realizedFrom = addDaysToDay(today, -REALIZED_DAYS)

  const inWindow = (m: CashFlowMovement): boolean => {
    const day = cashDay(m, today)
    if (isPending(m)) return day <= end
    if (isSettled(m)) return day >= realizedFrom && day <= today
    return false
  }

  return movements
    .filter((m) => m.dueDate != null && inWindow(m))
    .map((m) => {
      const item: DueItem = {
        id: m.id,
        title: m.title,
        category: m.category,
        direction: m.direction,
        amount: cashAmount(m),
        dueDate: toLocalDay(m.dueDate!),
        status: m.status as DueItem['status'],
        overdue: isOverdue(m, today),
      }
      if (isSettled(m)) item.settledAt = cashDay(m, today)
      return item
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, 'pt-BR'))
}

export interface CashFlowInput {
  today: string
  horizon: number
  cashToday: number
  movements: CashFlowMovement[]
  outflowHistory: { total: number; firstMovementDay: string | null }
}

/** O relatório inteiro, a partir das linhas e dos agregados que o repositório trouxe. */
export function computeCashFlow (input: CashFlowInput): CashFlowReport {
  const { today, horizon, cashToday, movements, outflowHistory } = input

  const projection = buildProjection({ today, horizon, cashToday, movements })
  const pending = summarizePending(movements, today, horizon)
  const threshold = safetyThreshold({ today, outflowTotal: outflowHistory.total, firstMovementDay: outflowHistory.firstMovementDay })
  const critical = criticalDayInsight(projection, threshold.value)

  return {
    horizon,
    today,
    cashToday,
    receivable: pending.receivable,
    payable: pending.payable,
    projectedBalance: projection[projection.length - 1].balance,
    lowestBalance: lowestPoint(projection),
    overdue: pending.overdue,
    safetyThreshold: threshold,
    projection,
    realized: buildRealized({ today, cashToday, movements }),
    weeks: groupWeeks(projection),
    dueItems: buildDueItems(movements, today, horizon),
    insights: critical ? [critical] : [],
  }
}
