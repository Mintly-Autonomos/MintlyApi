import {
  CashFlowReport, DreGroup, ExpensesReport, HealthLabel, HealthPillar, HealthPillarKey,
  OverviewInsight, OverviewReport, ResultReport,
} from 'mintly-lib'
import { fromCents, toCents } from '../../core/money/money'
import { addMonths } from '../reports/shared/period'
import { project, projectionWindow } from '../reports/expenses/expenses-detail'

/**
 * Visão Geral (fatia 8, spec 20261013/visao-geral.md) — composição pura dos
 * relatórios do mês (DRE, Custos) e de hoje (Fluxo de Caixa).
 *
 * Score de saúde: pesos, pontas e faixas são PROPOSTA do design — a MIN-83 não
 * os define (pendência N5). Ajuste aqui.
 */
export const HEALTH_WEIGHTS: Record<HealthPillarKey, number> = { netMargin: 0.30, runway: 0.30, primeCost: 0.25, revenueTrend: 0.15 }
/** Valor que dá nota 0 e valor que dá nota 100 (linear entre os dois). */
export const PILLAR_RANGES: Record<HealthPillarKey, { zero: number; full: number }> = {
  netMargin: { zero: 0, full: 0.10 },
  runway: { zero: 0, full: 45 },
  primeCost: { zero: 0.85, full: 0.65 },
  revenueTrend: { zero: -0.20, full: 0 },
}
export const HEALTH_BANDS = { risk: 40, attention: 70 }
export const OVERVIEW_HORIZON = 30
export const MAX_INSIGHTS = 4
/** Ajuste A4: com menos pilares que isso, a nota não diz muito — sem nota (palpite N5). */
export const MIN_PILLARS = 2

export interface OverviewInput {
  result: ResultReport
  cashFlow: CashFlowReport
  expenses: ExpensesReport
  today: Date
}

const PILLAR_ORDER: HealthPillarKey[] = ['netMargin', 'runway', 'primeCost', 'revenueTrend']
const SEVERITY_RANK: Record<OverviewInsight['severity'], number> = { warning: 0, positive: 1, info: 2 }

export function pillarScore (key: HealthPillarKey, value: number | null): number | null {
  if (value == null) return null
  const { zero, full } = PILLAR_RANGES[key]
  return Math.min(100, Math.max(0, ((value - zero) / (full - zero)) * 100))
}

/** Média ponderada dos pilares com nota (pesos redistribuídos); menos de MIN_PILLARS → null. */
export function healthScore (pillars: HealthPillar[]): number | null {
  const scored = pillars.filter((p) => p.score != null)
  if (scored.length < MIN_PILLARS) return null
  const weight = scored.reduce((a, p) => a + p.weight, 0)
  return Math.round(scored.reduce((a, p) => a + p.weight * p.score!, 0) / weight)
}

export function healthLabel (score: number | null): HealthLabel {
  if (score == null) return 'noData'
  if (score < HEALTH_BANDS.risk) return 'risk'
  if (score < HEALTH_BANDS.attention) return 'attention'
  return 'healthy'
}

/** Fôlego: caixa ÷ despesa média diária, em dias inteiros (para baixo), em centavos. */
export function runwayDays (cashToday: number, avgDailyOutflow: number): number | null {
  if (avgDailyOutflow <= 0) return null
  if (cashToday <= 0) return 0
  return Math.floor(toCents(cashToday) / toCents(avgDailyOutflow))
}

/** (base − média dos meses M−1..M−3 com receita) / média; nenhum → null. */
export function revenueTrend (base: number, history: { month: string; grossRevenue: number }[], month: string): number | null {
  const previous = [1, 2, 3].map((i) => addMonths(month, -i))
  const values = history.filter((h) => previous.includes(h.month) && h.grossRevenue > 0).map((h) => h.grossRevenue)
  if (values.length === 0) return null
  const avg = values.reduce((a, v) => a + v, 0) / values.length
  return (base - avg) / avg
}

/** Σ do campo dos itens de Custos nos grupos ÷ receita; receita 0 → null. */
function groupPct (expenses: ExpensesReport, groups: DreGroup[], field: 'previous', revenue: number): number | null {
  if (revenue === 0) return null
  const cents = expenses.items.filter((i) => i.dreGroup != null && groups.includes(i.dreGroup)).reduce((a, i) => a + toCents(i[field]), 0)
  return cents / toCents(revenue)
}

const points = (pct: number | null, previous: number | null) => (pct == null || previous == null ? null : (pct - previous) * 100)

/** Mês-base dos indicadores de CMV/prime cost (score e insights). */
interface Basis { month: string; cmvPct: number | null; primePct: number | null; revenue: number }

function buildInsights ({ result, cashFlow, expenses }: OverviewInput, basis: Basis): OverviewInsight[] {
  const list: OverviewInsight[] = []
  const critical = cashFlow.insights.find((i) => i.kind === 'criticalDay')
  if (critical) list.push({ kind: 'cashTight', severity: 'warning', date: critical.date, balance: critical.balance })

  // Ajuste A3: CMV/prime cost avaliados no mês-base do score (no mês atual, o
  // último mês fechado) — o mês pela metade não gera alerta que o score desmente.
  const cmvMax = expenses.cmv.target.max
  if (basis.cmvPct != null && basis.cmvPct > cmvMax) {
    list.push({ kind: 'cmvAboveTarget', severity: 'warning', pct: basis.cmvPct, targetMax: cmvMax, impact: fromCents(Math.round((basis.cmvPct - cmvMax) * toCents(basis.revenue))), basisMonth: basis.month })
  }
  if (basis.primePct != null && basis.primePct > expenses.primeCost.targetMax) {
    list.push({ kind: 'primeCostAboveTarget', severity: 'warning', pct: basis.primePct, targetMax: expenses.primeCost.targetMax, basisMonth: basis.month })
  }
  const anomaly = expenses.anomalies[0]
  if (anomaly) list.push({ kind: 'expenseAnomaly', severity: 'warning', name: anomaly.name, categoryName: anomaly.categoryName, excess: anomaly.excess, pctAbove: anomaly.pctAbove })
  if (result.breakEven.reachedOnDay != null) list.push({ kind: 'breakEvenReached', severity: 'positive', day: result.breakEven.reachedOnDay })
  if (result.insights.some((i) => i.kind === 'taxRegimeNotConfigured')) list.push({ kind: 'taxRegimeNotConfigured', severity: 'info' })

  // sort é estável: dentro da mesma severidade fica a ordem do catálogo.
  return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, MAX_INSIGHTS)
}

export function computeOverview (input: OverviewInput): OverviewReport {
  const { result, cashFlow, expenses, today } = input
  const month = result.referenceMonth
  const window = projectionWindow(month, today)
  // Mês atual: receita projetada (ponto projetado de Receita × Despesa). Vem de
  // Custos, que extrapola só o que já aconteceu e soma o lançado para depois de
  // hoje pelo valor cheio (mesma regra da despesa projetada).
  const revenueBase = window
    ? (expenses.projection?.revenue ?? fromCents(project(toCents(result.current.grossRevenue), window)))
    : result.current.grossRevenue

  const runway = runwayDays(cashFlow.cashToday, cashFlow.safetyThreshold.avgDailyOutflow)
  const cmvPrev = groupPct(expenses, [DreGroup.Cmv], 'previous', expenses.revenue.previous)
  const primePrev = groupPct(expenses, [DreGroup.Cmv, DreGroup.Labor], 'previous', expenses.revenue.previous)

  // Base do score (decisão A da revisão). Mês atual: a saúde de HOJE — pilares do
  // mês vêm do último mês fechado (o mês pela metade puxaria a nota para "risco"
  // na primeira semana) + fôlego de hoje. Mês passado: a nota daquele mês, sem o
  // fôlego (não temos o caixa da época) — e ela não muda com o tempo.
  const basisMonth = window ? addMonths(month, -1) : month
  const basisPoint = result.history.find((h) => h.month === basisMonth)
  // No mês atual a base é o mês fechado CHEIO (histórico) — o "mês anterior" de
  // Custos agora é do mesmo período (ajuste A1) e não serve de base.
  const basisRevenue = window ? (basisPoint?.grossRevenue ?? 0) : expenses.revenue.current
  const basisGroupPct = (groups: DreGroup[]): number | null => {
    if (basisRevenue === 0) return null
    const cents = expenses.items
      .filter((i) => i.dreGroup != null && groups.includes(i.dreGroup))
      .reduce((a, i) => a + toCents(window ? (i.history.find((h) => h.month === basisMonth)?.amount ?? 0) : i.amount), 0)
    return cents / toCents(basisRevenue)
  }
  const basis: Basis = { month: basisMonth, cmvPct: basisGroupPct([DreGroup.Cmv]), primePct: basisGroupPct([DreGroup.Cmv, DreGroup.Labor]), revenue: basisRevenue }
  const values: Record<HealthPillarKey, number | null> = window
    ? {
      netMargin: basisPoint?.netMargin ?? null,
      runway,
      primeCost: basis.primePct,
      revenueTrend: basisPoint ? revenueTrend(basisPoint.grossRevenue, result.history, basisMonth) : null,
    }
    : {
      netMargin: result.current.netMargin,
      runway: null,
      primeCost: expenses.primeCost.pctOfRevenue,
      revenueTrend: revenueTrend(result.current.grossRevenue, result.history, month),
    }
  const pillars: HealthPillar[] = PILLAR_ORDER.map((key) => ({ key, weight: HEALTH_WEIGHTS[key], score: pillarScore(key, values[key]), value: values[key] }))
  const score = healthScore(pillars)

  const expenseByMonth = new Map(expenses.history.map((h) => [h.month, h.total]))

  const revenueVsExpense = result.history.map((h) => ({ month: h.month, revenue: h.grossRevenue, expense: expenseByMonth.get(h.month) ?? 0, projected: false }))
  if (window) revenueVsExpense.push({ month, revenue: revenueBase, expense: expenses.projection?.total ?? expenses.total.current, projected: true })

  return {
    referenceMonth: month,
    today: cashFlow.today,
    cards: {
      netProfit: { amount: result.current.netProfit, delta: result.deltas.netProfit, history: result.history.map((h) => ({ month: h.month, amount: h.netProfit })) },
      revenue: { amount: result.current.grossRevenue, delta: result.deltas.grossRevenue, history: result.history.map((h) => ({ month: h.month, amount: h.grossRevenue })) },
      cashToday: { amount: cashFlow.cashToday, realized: cashFlow.realized.map((p) => ({ date: p.date, balance: p.balance })) },
      projection: { horizon: cashFlow.horizon, balance: cashFlow.projectedBalance, lowest: cashFlow.lowestBalance, runwayDays: runway },
      cmv: { pct: expenses.cmv.pctOfRevenue, previousPct: cmvPrev, deltaPoints: points(expenses.cmv.pctOfRevenue, cmvPrev), target: expenses.cmv.target },
      primeCost: { pct: expenses.primeCost.pctOfRevenue, previousPct: primePrev, deltaPoints: points(expenses.primeCost.pctOfRevenue, primePrev), targetMax: expenses.primeCost.targetMax },
    },
    health: { score, label: healthLabel(score), basisMonth, pillars, bands: HEALTH_BANDS },
    insights: buildInsights(input, basis),
    revenueVsExpense,
    profitWaterfall: {
      grossRevenue: result.current.grossRevenue,
      taxes: result.current.taxes,
      cmv: result.current.cmv,
      operatingExpenses: result.current.operatingExpenses,
      netProfit: result.current.netProfit,
    },
    comparison: result.comparison ?? { kind: 'fullMonth', untilDay: null },
  }
}
