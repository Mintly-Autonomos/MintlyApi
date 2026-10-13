import { describe, expect, it } from 'vitest'
import { HealthPillar } from 'mintly-lib'
import { computeOverview, healthLabel, healthScore, pillarScore, revenueTrend, runwayDays } from './overview-metrics'
import { OVERVIEW_MONTH, overviewScenario } from './overview-scenario'

describe('pillarScore (linear, limitado a 0..100)', () => {
  it.each([
    ['netMargin', 0, 0], ['netMargin', 0.05, 50], ['netMargin', 0.10, 100], ['netMargin', 0.2, 100], ['netMargin', -0.1, 0],
    ['runway', 0, 0], ['runway', 22.5, 50], ['runway', 45, 100], ['runway', 90, 100],
    ['primeCost', 0.85, 0], ['primeCost', 0.75, 50], ['primeCost', 0.65, 100], ['primeCost', 0.5, 100], ['primeCost', 0.95, 0],
    ['revenueTrend', -0.2, 0], ['revenueTrend', -0.1, 50], ['revenueTrend', 0, 100], ['revenueTrend', 0.3, 100],
  ] as const)('%s %s → %s', (key, value, expected) => expect(pillarScore(key, value)).toBeCloseTo(expected, 10))
  it('sem valor → null', () => expect(pillarScore('runway', null)).toBeNull())
})

describe('healthScore e healthLabel', () => {
  const p = (key: HealthPillar['key'], weight: number, score: number | null): HealthPillar => ({ key, weight, score, value: null })
  it('média ponderada arredondada', () => {
    expect(healthScore([p('netMargin', 0.3, 100), p('runway', 0.3, 44.444), p('primeCost', 0.25, 100), p('revenueTrend', 0.15, 100)])).toBe(83)
  })
  it('pilar sem dado sai e os pesos se redistribuem', () => {
    expect(healthScore([p('netMargin', 0.3, 100), p('runway', 0.3, null), p('primeCost', 0.25, 0), p('revenueTrend', 0.15, null)])).toBe(55)
  })
  it('nenhum pilar → null', () => expect(healthScore([p('netMargin', 0.3, null)])).toBeNull())
  it.each([[null, 'noData'], [39, 'risk'], [40, 'attention'], [69, 'attention'], [70, 'healthy'], [100, 'healthy']] as const)('%s → %s', (score, label) => expect(healthLabel(score)).toBe(label))
})

describe('runwayDays', () => {
  it('dias inteiros para baixo', () => {
    expect(runwayDays(18_500, 925)).toBe(20)
    expect(runwayDays(18_500, 600)).toBe(30)
  })
  it('média 0 → null; caixa ≤ 0 → 0', () => {
    expect(runwayDays(5_000, 0)).toBeNull()
    expect(runwayDays(-300, 925)).toBe(0)
    expect(runwayDays(0, 925)).toBe(0)
  })
})

describe('revenueTrend', () => {
  const h = (values: number[]) => ['2026-04', '2026-05', '2026-06', '2026-07'].map((month, i) => ({ month, grossRevenue: values[i] }))
  it('contra a média dos 3 anteriores com receita', () => {
    expect(revenueTrend(58_400, h([50_000, 52_000, 54_200, 58_400]), '2026-07')).toBeCloseTo(58_400 / (156_200 / 3) - 1, 10)
  })
  it('ignora mês sem receita na média', () => {
    expect(revenueTrend(12_000, h([0, 10_000, 0, 12_000]), '2026-07')).toBeCloseTo(0.2, 10)
  })
  it('nenhum mês anterior com receita → null', () => expect(revenueTrend(12_000, h([0, 0, 0, 12_000]), '2026-07')).toBeNull())
})

describe('computeOverview — cenário (mês fechado)', () => {
  const r = computeOverview(overviewScenario())

  it('cabeçalho e cards do mês', () => {
    expect(r).toMatchObject({ referenceMonth: OVERVIEW_MONTH, today: '2026-08-10' })
    expect(r.cards.netProfit).toMatchObject({ amount: 6_372, delta: 0.249 })
    expect(r.cards.netProfit.history.map((x) => x.amount)).toEqual([3_000, 3_500, 4_200, 4_900, 5_100, 6_372])
    expect(r.cards.revenue).toMatchObject({ amount: 58_400, delta: 0.077 })
    expect(r.cards.revenue.history.at(-1)).toEqual({ month: '2026-07', amount: 58_400 })
  })

  it('cards de hoje: caixa, projeção e fôlego', () => {
    expect(r.cards.cashToday).toEqual({ amount: 18_500, realized: [{ date: '2026-08-09', balance: 18_100 }, { date: '2026-08-10', balance: 18_500 }] })
    expect(r.cards.projection).toEqual({ horizon: 30, balance: 3_900, lowest: { date: '2026-08-22', balance: 900 }, runwayDays: 20 })
  })

  it('CMV e prime cost com pontos percentuais', () => {
    expect(r.cards.cmv.pct).toBeCloseTo(0.36, 10)
    expect(r.cards.cmv.previousPct).toBeCloseTo(18_000 / 54_200, 10)
    expect(r.cards.cmv.deltaPoints).toBeCloseTo((0.36 - 18_000 / 54_200) * 100, 10)
    expect(r.cards.cmv.target).toEqual({ min: 0.28, max: 0.35 })
    expect(r.cards.primeCost.pct).toBeCloseTo(29_024 / 58_400, 10)
    expect(r.cards.primeCost.previousPct).toBeCloseTo(26_000 / 54_200, 10)
    expect(r.cards.primeCost.targetMax).toBe(0.65)
  })

  it('score 83, healthy, com os quatro pilares', () => {
    expect(r.health).toMatchObject({ score: 83, label: 'healthy', bands: { risk: 40, attention: 70 } })
    const byKey = Object.fromEntries(r.health.pillars.map((pl) => [pl.key, pl]))
    expect(byKey.netMargin).toMatchObject({ weight: 0.3, score: 100 })
    expect(byKey.runway).toMatchObject({ weight: 0.3, value: 20 })
    expect(byKey.runway.score).toBeCloseTo(44.444, 2)
    expect(byKey.primeCost).toMatchObject({ weight: 0.25, score: 100 })
    expect(byKey.revenueTrend).toMatchObject({ weight: 0.15, score: 100 })
    expect(byKey.revenueTrend.value).toBeCloseTo(58_400 / (156_200 / 3) - 1, 10)
  })

  it('insights na ordem e com os números', () => {
    expect(r.insights).toEqual([
      { kind: 'cashTight', severity: 'warning', date: '2026-08-22', balance: 900 },
      { kind: 'cmvAboveTarget', severity: 'warning', pct: 21_024 / 58_400, targetMax: 0.35, impact: 584 },
      { kind: 'expenseAnomaly', severity: 'warning', name: 'Embalagens', categoryName: 'CMV / Insumos', excess: 900, pctAbove: 0.6 },
      { kind: 'breakEvenReached', severity: 'positive', day: 19 },
    ])
  })

  it('Receita × Despesa (6 meses, sem ponto projetado) e cascata', () => {
    expect(r.revenueVsExpense).toHaveLength(6)
    expect(r.revenueVsExpense.at(-1)).toEqual({ month: '2026-07', revenue: 58_400, expense: 52_000, projected: false })
    expect(r.profitWaterfall).toEqual({ grossRevenue: 58_400, taxes: 3_504, cmv: 21_024, operatingExpenses: 27_500, netProfit: 6_372 })
  })
})

describe('computeOverview — bordas', () => {
  it('máximo 4 insights; prime cost acima entra antes da anomalia e info fica de fora', () => {
    const input = overviewScenario()
    ;(input.expenses.primeCost as any).pctOfRevenue = 0.7
    ;(input.result as any).insights = [{ kind: 'taxRegimeNotConfigured', severity: 'info' }]
    expect(computeOverview(input).insights.map((i) => i.kind)).toEqual(['cashTight', 'cmvAboveTarget', 'primeCostAboveTarget', 'expenseAnomaly'])
  })

  it('só positivos e info: ordem positive → info', () => {
    const input = overviewScenario()
    ;(input.cashFlow as any).insights = []
    ;(input.expenses.cmv as any).pctOfRevenue = 0.3
    ;(input.expenses as any).anomalies = []
    ;(input.result as any).insights = [{ kind: 'taxRegimeNotConfigured', severity: 'info' }]
    expect(computeOverview(input).insights.map((i) => i.kind)).toEqual(['breakEvenReached', 'taxRegimeNotConfigured'])
  })

  it('mês atual no dia 10: tendência e ponto projetado usam a receita projetada', () => {
    const input = overviewScenario()
    input.today = new Date('2026-07-10T15:00:00Z')
    ;(input.result.current as any).grossRevenue = 10_000
    ;(input.result as any).history = ['2026-04', '2026-05', '2026-06', '2026-07'].map((month, i) => ({ month, grossRevenue: [30_000, 30_000, 30_000, 10_000][i], netProfit: 0, netMargin: null }))
    ;(input.expenses as any).projection = { total: 40_000, elapsedDays: 10, daysInMonth: 31 }
    const r = computeOverview(input)
    const trend = r.health.pillars.find((pl) => pl.key === 'revenueTrend')!
    expect(trend.value).toBeCloseTo(31_000 / 30_000 - 1, 10)
    expect(trend.score).toBe(100)
    expect(r.revenueVsExpense.at(-1)).toEqual({ month: '2026-07', revenue: 31_000, expense: 40_000, projected: true })
  })

  it('mês atual no dia 1: projeta ×dias do mês, sem divisão por zero', () => {
    const input = overviewScenario()
    input.today = new Date('2026-07-01T15:00:00Z')
    ;(input.result.current as any).grossRevenue = 1_000
    const trend = computeOverview(input).health.pillars.find((pl) => pl.key === 'revenueTrend')!
    expect(trend.value).toBeCloseTo(31_000 / (156_200 / 3) - 1, 10)
  })

  it('restaurante sem dados: score null, noData, nada de NaN', () => {
    const input = overviewScenario()
    ;(input.result as any).current = { grossRevenue: 0, taxes: 0, netRevenue: 0, cmv: 0, grossMargin: 0, operatingExpenses: 0, netProfit: 0, netMargin: null }
    ;(input.result as any).history = []
    ;(input.result as any).breakEven = { fixedCosts: 0, variableCosts: 0, contributionMarginPct: null, breakEvenRevenue: null, reachedOnDay: null }
    ;(input.cashFlow as any).safetyThreshold = { value: 0, days: 7, avgDailyOutflow: 0 }
    ;(input.cashFlow as any).insights = []
    ;(input.expenses as any).cmv = { amount: 0, pctOfRevenue: null, target: { min: 0.28, max: 0.35 } }
    ;(input.expenses as any).primeCost = { amount: 0, cmv: 0, labor: 0, pctOfRevenue: null, targetMax: 0.65 }
    ;(input.expenses as any).revenue = { current: 0, previous: 0 }
    ;(input.expenses as any).anomalies = []
    const r = computeOverview(input)
    expect(r.health).toMatchObject({ score: null, label: 'noData' })
    expect(r.cards.cmv).toMatchObject({ pct: null, previousPct: null, deltaPoints: null })
    expect(r.cards.projection.runwayDays).toBeNull()
    expect(r.insights).toEqual([])
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })

  it('caixa negativo: fôlego 0 e pilar com nota 0', () => {
    const input = overviewScenario()
    ;(input.cashFlow as any).cashToday = -2_000
    const r = computeOverview(input)
    expect(r.cards.projection.runwayDays).toBe(0)
    expect(r.health.pillars.find((pl) => pl.key === 'runway')!.score).toBe(0)
  })
})
