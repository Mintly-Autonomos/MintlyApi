import { describe, expect, it } from 'vitest'
import { CategoryBehavior, DreGroup, OperationalNature, TaxRegime } from 'mintly-lib'
import { CategoryInfo, MonthlyTotalRow, aggregateMonth, buildBreakEven, buildDeltas, buildInsights, buildLines, buildOpexItems, computeResult, hasActivity, monthTax, relativeDelta } from './result-metrics'

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
    // categoria presente mas zerada (gasto do mês anterior caiu depois do dia de corte) não conta
    expect(hasActivity(aggregateMonth([row({ categoryId: 'mkt', gross: 0 })], M, CATS))).toBe(false)
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
    // Reteste 18/11, item 2: sem o valor do DAS-MEI configurado, vale o DAS pago no mês.
    expect(monthTax({ regime: TaxRegime.Mei, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null })).toEqual({ effectiveRate: null, fixedAmount: null, usePaidTax: true })
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
      nonOperatingIncome: 0,
      nonOperatingExpenses: 0,
      resultAfterNonOperating: 6_372,
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

  it('buildDeltas cobre as linhas (inclusive as do não operacional) e ignora a margem', () => {
    const lines = (v: number) => ({ grossRevenue: v, taxes: v, netRevenue: v, cmv: v, grossMargin: v, operatingExpenses: v, netProfit: v, netMargin: 0.1, nonOperatingIncome: v, nonOperatingExpenses: v, resultAfterNonOperating: v })
    const deltas = buildDeltas(lines(120), lines(100))
    expect(Object.keys(deltas)).toEqual(['grossRevenue', 'taxes', 'netRevenue', 'cmv', 'grossMargin', 'operatingExpenses', 'netProfit', 'nonOperatingIncome', 'nonOperatingExpenses', 'resultAfterNonOperating'])
    for (const v of Object.values(deltas)) expect(v).toBeCloseTo(0.2, 10)
  })
})

describe('não operacional (empréstimo, aporte, equipamento)', () => {
  const NON_OP: [string, CategoryInfo][] = [
    ['emprestimo', { id: 'emprestimo', name: 'Empréstimos recebidos', behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.NonOperational }],
    ['aporte', { id: 'aporte', name: 'Aporte da sócia', behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.NonOperational }],
    ['equip', { id: 'equip', name: 'Equipamentos', behavior: CategoryBehavior.Variable, dreGroup: DreGroup.Opex, operationalNature: OperationalNature.NonOperational }],
    ['vendas', { id: 'vendas', name: 'Vendas', behavior: CategoryBehavior.Variable, operationalNature: OperationalNature.Operational }],
    ['aluguel', { id: 'aluguel', name: 'Aluguel', behavior: CategoryBehavior.Fixed, dreGroup: DreGroup.Opex }],
  ]
  const cats = new Map(NON_OP)
  const row = (direction: 'in' | 'out', categoryId: string, gross: number): MonthlyTotalRow => ({ month: M, direction, categoryId, categoryName: categoryId, gross, fee: 0 })
  // o caso de setembro do relatório: vendas de 26.795, empréstimo de 15 mil e aporte de 3 mil, conserto de 3.850
  const rows = [row('in', 'vendas', 26_795), row('in', 'emprestimo', 15_000), row('in', 'aporte', 3_000), row('out', 'aluguel', 4_200), row('out', 'equip', 3_850)]

  it('não entra na receita nem nas despesas (e não mexe nos fixos/variáveis do ponto de equilíbrio)', () => {
    const agg = aggregateMonth(rows, M, cats)
    expect(agg.grossRevenue).toBe(2_679_500)
    expect([...agg.opexCategories.keys()]).toEqual(['aluguel'])
    expect(agg.fixed).toBe(420_000)
    expect(agg.variable).toBe(0)
    expect(agg.nonOperatingIncome).toBe(1_800_000)
    expect(agg.nonOperatingExpenses).toBe(385_000)
  })

  it('aparece em linhas próprias depois do resultado operacional', () => {
    const lines = buildLines(aggregateMonth(rows, M, cats), { effectiveRate: null, fixedAmount: null })
    expect(lines).toMatchObject({
      grossRevenue: 26_795,
      operatingExpenses: 4_200,
      netProfit: 22_595,
      nonOperatingIncome: 18_000,
      nonOperatingExpenses: 3_850,
      resultAfterNonOperating: 22_595 + 18_000 - 3_850,
    })
  })

  it('mês só com não operacional (ex.: o saldo inicial) não conta como mês com atividade', () => {
    expect(hasActivity(aggregateMonth([row('in', 'aporte', 18_500)], M, cats))).toBe(false)
  })
})

describe('buildOpexItems', () => {
  it('categoria zerada no mês e no anterior não é listada (mês atual pelo mesmo período)', () => {
    const current = aggregateMonth([row({ direction: 'in', categoryId: 'ven', gross: 1_000 })], M, CATS)
    const previous = aggregateMonth([row({ month: '2026-06', categoryId: 'mkt', gross: 0 })], '2026-06', CATS)
    expect(buildOpexItems(current, previous)).toEqual([])
  })

  const cur = aggregateMonth([
    row({ direction: 'in', categoryId: 'ven', gross: 10_000, fee: 600 }),
    row({ categoryId: 'pro', gross: 800 }),
    row({ categoryId: 'mkt', gross: 120 }),
    row({ categoryId: 'alu', gross: 120 }),
  ], M, CATS)
  const prev = aggregateMonth([
    row({ month: '2026-06', categoryId: 'pro', gross: 800 }),
    row({ month: '2026-06', categoryId: 'uti', gross: 200 }),
    row({ month: '2026-06', categoryId: 'mkt', gross: 90 }),
  ], '2026-06', CATS)

  it('categorias de M e M−1 + taxa de plataforma, do maior para o menor, empate por nome', () => {
    const items = buildOpexItems(cur, prev)
    expect(items.map((i) => [i.name, i.amount, i.previousAmount])).toEqual([
      ['Pró-labore', 800, 800],
      ['Taxa de plataforma', 600, 0],
      ['Aluguel', 120, 0],
      ['Marketing', 120, 90],
      ['Utilidades', 0, 200],
    ])
  })

  it('item com variação, % da receita, tipo e comportamento', () => {
    const items = buildOpexItems(cur, prev)
    expect(items[1]).toEqual({ categoryId: null, name: 'Taxa de plataforma', kind: 'platformFee', behavior: 'variable', amount: 600, previousAmount: 0, delta: null, revenuePct: 0.06 })
    expect(items[3]).toMatchObject({ categoryId: 'mkt', kind: 'opex' })
    expect(items[3].delta).toBeCloseTo(30 / 90, 10)
    expect(items[0]).toMatchObject({ kind: 'labor', delta: 0, revenuePct: 0.08 })
  })

  it('sem taxa nos dois meses: sem item sintético; sem receita: % null', () => {
    const items = buildOpexItems(prev, prev)
    expect(items.some((i) => i.kind === 'platformFee')).toBe(false)
    expect(items[0].revenuePct).toBeNull()
  })
})

describe('buildBreakEven', () => {
  // Fixos 17.656 (pró-labore 8.000 + aluguel/contador 7.456 + utilidades 2.200 misto)
  const agg = aggregateMonth([
    row({ direction: 'in', categoryId: 'ven', gross: 58_400, fee: 6_044 }),
    row({ categoryId: 'cmv', gross: 21_024 }),
    row({ categoryId: 'pro', gross: 8_000 }),
    row({ categoryId: 'alu', gross: 7_456 }),
    row({ categoryId: 'uti', gross: 2_200 }),
    row({ categoryId: 'mkt', gross: 3_800 }),
  ], M, CATS)
  const lines = buildLines(agg, { effectiveRate: 0.06, fixedAmount: null })
  const daily = new Map([['2026-07-01', 20_000], ['2026-07-10', 20_000], ['2026-07-20', 18_400]])

  it('margem de contribuição, ponto de equilíbrio e dia em que é atingido', () => {
    const be = buildBreakEven(agg, lines, M, daily)
    expect(be.fixedCosts).toBe(17_656)
    expect(be.variableCosts).toBe(21_024 + 3_800 + 6_044)
    expect(be.contributionMarginPct).toBeCloseTo((54_896 - 30_868) / 54_896, 10)
    // Receita BRUTA necessária (é o que o dono compara com o que vende):
    // fixos ÷ ((líquida − variáveis) / bruta) = 17.656 × 58.400 / 24.028 = 42.912,87
    expect(be.breakEvenRevenue).toBe(42_912.87)
    expect(be.reachedOnDay).toBe(20) // dia 10: 40.000 < 42.912,87; dia 20: 58.400
  })

  it('não alcançado no mês: null', () => {
    expect(buildBreakEven(agg, lines, M, new Map([['2026-07-01', 1_000]])).reachedOnDay).toBeNull()
  })

  it('sem custo fixo: alcançado no dia 1', () => {
    const variableOnly = aggregateMonth([row({ direction: 'in', categoryId: 'ven', gross: 1_000 }), row({ categoryId: 'mkt', gross: 100 })], M, CATS)
    expect(buildBreakEven(variableOnly, buildLines(variableOnly, { effectiveRate: null, fixedAmount: null }), M, new Map([['2026-07-01', 1_000]])))
      .toMatchObject({ breakEvenRevenue: 0, reachedOnDay: 1 })
  })

  it('margem de contribuição ≤ 0 ou sem receita: null', () => {
    const loss = aggregateMonth([row({ direction: 'in', categoryId: 'ven', gross: 100 }), row({ categoryId: 'mkt', gross: 500 })], M, CATS)
    expect(buildBreakEven(loss, buildLines(loss, { effectiveRate: null, fixedAmount: null }), M, new Map()))
      .toMatchObject({ contributionMarginPct: -4, breakEvenRevenue: null, reachedOnDay: null })
    const none = aggregateMonth([], M, CATS)
    expect(buildBreakEven(none, buildLines(none, { effectiveRate: null, fixedAmount: null }), M, new Map()))
      .toMatchObject({ contributionMarginPct: null, breakEvenRevenue: null, reachedOnDay: null })
  })
})

describe('buildInsights', () => {
  const lines = (netProfit: number, grossRevenue = 1_000) => ({ grossRevenue, taxes: 0, netRevenue: grossRevenue, cmv: 0, grossMargin: grossRevenue, operatingExpenses: grossRevenue - netProfit, netProfit, netMargin: grossRevenue > 0 ? netProfit / grossRevenue : null })
  const items = [{ categoryId: 'pro', name: 'Pró-labore', kind: 'labor' as const, behavior: CategoryBehavior.Fixed, amount: 800, previousAmount: 800, delta: 0, revenuePct: 0.08 }]

  it('lucro subiu: positive; maior despesa; regime configurado', () => {
    expect(buildInsights({ regime: TaxRegime.Mei, current: lines(300), previous: lines(100), previousHasActivity: true, items })).toEqual([
      { kind: 'profitChanged', severity: 'positive', difference: 200, previousProfit: 100, currentProfit: 300, previousMargin: 0.1, currentMargin: 0.3 },
      { kind: 'largestOpexItem', severity: 'warning', name: 'Pró-labore', amount: 800, revenuePct: 0.08 },
    ])
  })

  it('lucro caiu: warning; sem mês anterior: sem profitChanged; sem regime: aviso', () => {
    expect(buildInsights({ regime: TaxRegime.Mei, current: lines(50), previous: lines(100), previousHasActivity: true, items: [] })[0]).toMatchObject({ kind: 'profitChanged', severity: 'warning', difference: -50 })
    expect(buildInsights({ regime: null, current: lines(50), previous: lines(0, 0), previousHasActivity: false, items: [] }))
      .toEqual([{ kind: 'taxRegimeNotConfigured', severity: 'info' }])
  })
})

describe('computeResult', () => {
  it('monta o relatório com 6 meses de histórico (meses vazios inclusive)', () => {
    const report = computeResult({
      referenceMonth: M,
      regime: TaxRegime.SimplesNacionalAnexoI,
      rows: [
        row({ direction: 'in', categoryId: 'ven', gross: 58_400, fee: 6_044 }),
        row({ categoryId: 'cmv', gross: 21_024 }),
        row({ categoryId: 'pro', gross: 21_456 }),
        row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 33_000 }),
      ],
      categories: CATS,
      taxByMonth: new Map([[M, { effectiveRate: 0.06, fixedAmount: null }], ['2026-06', { effectiveRate: 0.06, fixedAmount: null }]]),
      meiMonthlyDas: null,
      dailyRevenue: new Map([['2026-07-05', 58_400]]),
    })

    expect(report).toMatchObject({
      referenceMonth: M,
      previousMonth: '2026-06',
      current: { grossRevenue: 58_400, taxes: 3_504, netProfit: 6_372 },
      previous: { grossRevenue: 33_000, taxes: 1_980, netProfit: 31_020 },
      tax: { regime: TaxRegime.SimplesNacionalAnexoI, effectiveRate: 0.06, meiMonthlyDas: null },
    })
    expect(report.history.map((h) => h.month)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
    expect(report.history[0]).toEqual({ month: '2026-02', grossRevenue: 0, netProfit: 0, netMargin: null })
    expect(report.deltas.grossRevenue).toBeCloseTo((58_400 - 33_000) / 33_000, 10)
    expect(report.insights.map((i) => i.kind)).toEqual(['profitChanged', 'largestOpexItem'])
  })

  it('MEI: DAS do mês no campo tax; mês sem imposto informado usa "sem regime"', () => {
    const report = computeResult({ referenceMonth: M, regime: TaxRegime.Mei, rows: [], categories: CATS, taxByMonth: new Map(), meiMonthlyDas: 82.05, dailyRevenue: new Map() })
    expect(report.tax).toEqual({ regime: TaxRegime.Mei, effectiveRate: null, meiMonthlyDas: 82.05 })
    expect(report.current.taxes).toBe(0)
  })

  it('ajuste A1 — mês atual: anterior e variações pelo mesmo período (até o dia de hoje)', () => {
    const report = computeResult({
      referenceMonth: M,
      regime: TaxRegime.SimplesNacionalAnexoI,
      rows: [
        row({ direction: 'in', categoryId: 'ven', gross: 20_000 }),
        row({ categoryId: 'pro', gross: 9_000 }),
        // junho inteiro: 60.000 de receita e 9.000 de pessoal; até o dia 13: 25.000 e 9.000
        row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 60_000, grossUntil: 25_000 }),
        row({ month: '2026-06', categoryId: 'pro', gross: 9_000, grossUntil: 9_000 }),
      ],
      categories: CATS,
      taxByMonth: new Map([[M, { effectiveRate: 0.06, fixedAmount: null }], ['2026-06', { effectiveRate: 0.06, fixedAmount: null }]]),
      meiMonthlyDas: null,
      dailyRevenue: new Map(),
      untilDay: 13,
    })

    expect(report.comparison).toEqual({ kind: 'samePeriod', untilDay: 13 })
    expect(report.previous.grossRevenue).toBe(25_000)
    expect(report.deltas.grossRevenue).toBeCloseTo(20_000 / 25_000 - 1, 10)
    expect(report.history.find((h) => h.month === '2026-06')!.grossRevenue).toBe(60_000)
    expect(report.insights[0]).toMatchObject({ kind: 'profitChanged', previousProfit: 25_000 - 1_500 - 9_000 })
  })

  it('revisão — variação do mês atual ignora o agendado para depois de hoje', () => {
    const report = computeResult({
      referenceMonth: M,
      regime: null,
      rows: [
        row({ direction: 'in', categoryId: 'ven', gross: 20_000, grossUntil: 15_000 }),
        row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 60_000, grossUntil: 25_000 }),
      ],
      categories: CATS,
      taxByMonth: new Map(),
      meiMonthlyDas: null,
      dailyRevenue: new Map(),
      untilDay: 13,
    })
    // Reteste 18/11, itens 3 e 8: o mês em andamento é mostrado até hoje, o mesmo corte da variação.
    expect(report.current.grossRevenue).toBe(15_000)
    expect(report.history.at(-1)!.grossRevenue).toBe(15_000)
    expect(report.deltas.grossRevenue).toBeCloseTo(15_000 / 25_000 - 1, 10)
  })

  it('ajuste A1 — mês fechado: meses cheios', () => {
    const report = computeResult({ referenceMonth: M, regime: null, rows: [row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 60_000, grossUntil: 25_000 })], categories: CATS, taxByMonth: new Map(), meiMonthlyDas: null, dailyRevenue: new Map(), untilDay: null })
    expect(report.comparison).toEqual({ kind: 'fullMonth', untilDay: null })
    expect(report.previous.grossRevenue).toBe(60_000)
  })
})

describe('U.4 — histórico de 12 meses e mesmo mês do ano anterior', () => {
  const base = { regime: null, categories: CATS, taxByMonth: new Map(), meiMonthlyDas: null, dailyRevenue: new Map() }

  it('historyMonths 12: 12 pontos, do mês −11 ao mês de referência; padrão continua 6', () => {
    const doze = computeResult({ ...base, referenceMonth: M, rows: [], historyMonths: 12 })
    expect(doze.history.map((h) => h.month)).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
    expect(computeResult({ ...base, referenceMonth: M, rows: [] }).history).toHaveLength(6)
  })

  it('previousYear: linhas do mesmo mês do ano anterior e a variação sobre ele', () => {
    const report = computeResult({
      ...base,
      referenceMonth: M,
      rows: [
        row({ direction: 'in', categoryId: 'ven', gross: 30_000 }),
        row({ month: '2025-07', direction: 'in', categoryId: 'ven', gross: 20_000 }),
        row({ month: '2025-07', categoryId: 'cmv', gross: 8_000 }),
      ],
    })
    expect(report.previousYear).toMatchObject({ month: '2025-07', lines: { grossRevenue: 20_000, cmv: 8_000 } })
    expect(report.previousYear!.deltas.grossRevenue).toBeCloseTo(0.5, 10)
  })

  it('sem lançamento no mesmo mês do ano anterior → null', () => {
    const report = computeResult({ ...base, referenceMonth: M, rows: [row({ direction: 'in', categoryId: 'ven', gross: 30_000 })] })
    expect(report.previousYear).toBeNull()
  })

  it('mês em andamento: compara os mesmos dias do ano anterior', () => {
    const report = computeResult({
      ...base,
      referenceMonth: M,
      untilDay: 10,
      rows: [
        row({ direction: 'in', categoryId: 'ven', gross: 30_000, grossUntil: 12_000 }),
        row({ month: '2025-07', direction: 'in', categoryId: 'ven', gross: 40_000, grossUntil: 10_000 }),
      ],
    })
    expect(report.previousYear!.lines.grossRevenue).toBe(10_000)
    expect(report.previousYear!.deltas.grossRevenue).toBeCloseTo(0.2, 10)
  })
})

describe('impostos: DAS pago não é gasto novo (reteste 18/11, item 2)', () => {
  // Como na conta testada: a categoria Impostos é do grupo "tax", mas marcada como não operacional.
  const cats = new Map<string, CategoryInfo>([
    ...CATS,
    ['impNo', { id: 'impNo', name: 'Impostos', dreGroup: DreGroup.Tax, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.NonOperational }],
    ['emp', { id: 'emp', name: 'Empréstimo', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.NonOperational }],
  ])
  const rows = [
    row({ direction: 'in', categoryId: 'ven', gross: 10_000 }),
    row({ categoryId: 'impNo', gross: 600 }),
    row({ categoryId: 'emp', gross: 700 }),
  ]

  it('o DAS fica fora do "não operacional" e vira taxPaid', () => {
    const agg = aggregateMonth(rows, M, cats)
    expect(agg.taxPaid).toBe(60_000)
    expect(agg.nonOperatingExpenses).toBe(70_000)
  })

  it('Simples: o imposto é o calculado; o DAS pago só quita, sem aparecer de novo', () => {
    const l = buildLines(aggregateMonth(rows, M, cats), { effectiveRate: 0.06, fixedAmount: null })
    expect(l.taxes).toBe(600)
    expect(l.nonOperatingExpenses).toBe(700)
    expect(l.resultAfterNonOperating).toBe(10_000 - 600 - 700)
  })

  it('MEI sem o valor configurado: o imposto do mês é o DAS pago', () => {
    const l = buildLines(aggregateMonth(rows, M, cats), { effectiveRate: null, fixedAmount: null, usePaidTax: true })
    expect(l.taxes).toBe(600)
    expect(l.netProfit).toBe(10_000 - 600)
  })

  it('MEI com o valor configurado usa o valor fixo', () => {
    expect(buildLines(aggregateMonth(rows, M, cats), { effectiveRate: null, fixedAmount: 82.05 }).taxes).toBe(82.05)
  })
})
