import { describe, expect, it } from 'vitest'
import { CategoryBehavior, DreGroup, TaxRegime } from 'mintly-lib'
import { CategoryInfo, MonthlyTotalRow, aggregateMonth, buildDeltas, buildLines, hasActivity, monthTax, relativeDelta } from './result-metrics'

const M = '2026-07'
const cat = (id: string, dreGroup: DreGroup | undefined, behavior: CategoryBehavior, name = id): [string, CategoryInfo] => [id, { id, name, dreGroup, behavior }]
const CATS = new Map<string, CategoryInfo>([
  cat('cmv', DreGroup.Cmv, CategoryBehavior.Variable, 'CMV'),
  cat('pro', DreGroup.Labor, CategoryBehavior.Fixed, 'Pró-labore'),
  cat('alu', DreGroup.Opex, CategoryBehavior.Fixed, 'Aluguel'),
  cat('uti', DreGroup.Opex, CategoryBehavior.Mixed, 'Utilidades'),
  cat('mkt', DreGroup.Opex, CategoryBehavior.Variable, 'Marketing'),
  cat('imp', DreGroup.Tax, CategoryBehavior.Fixed, 'Impostos'),
  cat('leg', undefined, CategoryBehavior.Variable, 'Legada sem grupo'),
])
const row = (over: Partial<MonthlyTotalRow>): MonthlyTotalRow => ({ month: M, direction: 'out', categoryId: 'x', categoryName: 'x', gross: 0, fee: 0, ...over })

describe('aggregateMonth', () => {
  const rows = [
    row({ direction: 'in', categoryId: 'ven', gross: 1000, fee: 100 }),
    row({ categoryId: 'cmv', gross: 300 }),
    row({ categoryId: 'pro', gross: 200 }),
    row({ categoryId: 'uti', gross: 50 }),
    row({ categoryId: 'mkt', gross: 40 }),
    row({ categoryId: 'imp', gross: 999 }),
    row({ categoryId: 'leg', gross: 10 }),
    row({ categoryId: 'sumiu', categoryName: 'Categoria apagada', gross: 5 }),
    row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 7777 }),
  ]
  const agg = aggregateMonth(rows, M, CATS)

  it('receita bruta e taxa de plataforma das entradas do mês', () => {
    expect(agg.grossRevenue).toBe(100_000)
    expect(agg.platformFee).toBe(10_000)
  })

  it('CMV separado; imposto fora; sem grupo e categoria sumida viram opex', () => {
    expect(agg.cmv).toBe(30_000)
    expect([...agg.opexCategories.values()].map((c) => [c.name, c.kind, c.cents])).toEqual([
      ['Pró-labore', 'labor', 20_000],
      ['Utilidades', 'opex', 5_000],
      ['Marketing', 'opex', 4_000],
      ['Legada sem grupo', 'opex', 1_000],
      ['Categoria apagada', 'opex', 500],
    ])
  })

  it('fixo inclui misto e categoria sumida; variável inclui a taxa de plataforma', () => {
    // fixo: pró-labore 200 + utilidades 50 (misto) + sumida 5 (sem info → fixo)
    expect(agg.fixed).toBe(25_500)
    // variável: cmv 300 + marketing 40 + legada 10 + taxa 100
    expect(agg.variable).toBe(45_000)
  })

  it('mês sem movimento', () => {
    const empty = aggregateMonth(rows, '2026-01', CATS)
    expect(empty).toMatchObject({ grossRevenue: 0, platformFee: 0, cmv: 0, fixed: 0, variable: 0 })
    expect(hasActivity(empty)).toBe(false)
    expect(hasActivity(agg)).toBe(true)
  })
})

describe('monthTax', () => {
  const revenue = new Map([['2026-06', 33_000], ['2026-07', 58_400]])

  it('Simples: alíquota efetiva do mês (RBT12 proporcional)', () => {
    expect(monthTax({ regime: TaxRegime.SimplesNacionalAnexoI, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null }).effectiveRate)
      .toBeCloseTo(0.06, 10) // RBT12 = 33.000 × 12 = 396.000 → (396.000 × 9,5% − 13.860) / 396.000
  })

  it('MEI: DAS a partir do mês da primeira movimentação; antes, zero', () => {
    expect(monthTax({ regime: TaxRegime.Mei, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: 82.05 })).toEqual({ effectiveRate: null, fixedAmount: 82.05 })
    expect(monthTax({ regime: TaxRegime.Mei, month: '2026-05', firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: 82.05 })).toEqual({ effectiveRate: null, fixedAmount: 0 })
    expect(monthTax({ regime: TaxRegime.Mei, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null })).toEqual({ effectiveRate: null, fixedAmount: 0 })
  })

  it('sem regime', () => {
    expect(monthTax({ regime: null, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null })).toEqual({ effectiveRate: null, fixedAmount: null })
  })
})

describe('buildLines', () => {
  const agg = aggregateMonth([
    row({ direction: 'in', categoryId: 'ven', gross: 58_400, fee: 6_044 }),
    row({ categoryId: 'cmv', gross: 21_024 }),
    row({ categoryId: 'pro', gross: 21_456 }),
  ], M, CATS)

  it('DRE com alíquota (o caso da print)', () => {
    expect(buildLines(agg, { effectiveRate: 0.06, fixedAmount: null })).toEqual({
      grossRevenue: 58_400,
      taxes: 3_504,
      netRevenue: 54_896,
      cmv: 21_024,
      grossMargin: 33_872,
      operatingExpenses: 27_500,
      netProfit: 6_372,
      netMargin: 6_372 / 58_400,
    })
  })

  it('MEI: imposto fixo; sem regime: zero', () => {
    expect(buildLines(agg, { effectiveRate: null, fixedAmount: 82.05 }).taxes).toBe(82.05)
    expect(buildLines(agg, { effectiveRate: null, fixedAmount: null }).taxes).toBe(0)
  })

  it('mês sem receita: margem null', () => {
    expect(buildLines(aggregateMonth([], M, CATS), { effectiveRate: 0.04, fixedAmount: null }))
      .toMatchObject({ grossRevenue: 0, taxes: 0, netProfit: 0, netMargin: null })
  })
})

describe('variações', () => {
  it('relativa com módulo no denominador', () => {
    expect(relativeDelta(110, 100)).toBeCloseTo(0.1, 10)
    expect(relativeDelta(-50, -100)).toBeCloseTo(0.5, 10) // prejuízo diminuiu → melhora
    expect(relativeDelta(10, 0)).toBeNull()
  })

  it('buildDeltas cobre as sete linhas e ignora a margem', () => {
    const lines = (v: number) => ({ grossRevenue: v, taxes: v, netRevenue: v, cmv: v, grossMargin: v, operatingExpenses: v, netProfit: v, netMargin: 0.1 })
    const deltas = buildDeltas(lines(120), lines(100))
    expect(Object.keys(deltas)).toEqual(['grossRevenue', 'taxes', 'netRevenue', 'cmv', 'grossMargin', 'operatingExpenses', 'netProfit'])
    for (const v of Object.values(deltas)) expect(v).toBeCloseTo(0.2, 10)
  })
})
