import { describe, expect, it } from 'vitest'
import { CategoryBehavior, DreGroup, MovementChannel } from 'mintly-lib'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { addMonths } from '../shared/period'
import { ExpenseRow, computeExpenses, parseExpensesChannel } from './expenses-metrics'
import { expensesScenarioCategories, expensesScenarioRows } from './expenses-scenario'

const M = '2026-08'
const scenario = (channel: MovementChannel | null = null, overrides: Partial<Parameters<typeof computeExpenses>[0]> = {}) => computeExpenses({
  referenceMonth: M, channel, rows: expensesScenarioRows(M), categories: expensesScenarioCategories(), accountNames: new Map(), firstMonth: addMonths(M, -3), ...overrides,
})
const byName = (r: ReturnType<typeof computeExpenses>, name: string) => r.items.find((i) => i.name === name)!

describe('parseExpensesChannel', () => {
  it('ausente ou vazio → Geral', () => {
    expect(parseExpensesChannel(undefined)).toBeNull()
    expect(parseExpensesChannel('')).toBeNull()
  })
  it('dineIn e delivery aceitos', () => {
    expect(parseExpensesChannel('dineIn')).toBe(MovementChannel.DineIn)
    expect(parseExpensesChannel('delivery')).toBe(MovementChannel.Delivery)
  })
  it.each(['shared', 'salao', 42])('%j → 400', (v) => expect(() => parseExpensesChannel(v)).toThrow(ValidationError))
})

describe('computeExpenses — cenário Geral', () => {
  const r = scenario()

  it('cabeçalho, receita e total', () => {
    expect(r).toMatchObject({ referenceMonth: M, previousMonth: '2026-07', channel: null, sharedExcluded: null, revenue: { current: 45_000, previous: 33_000 } })
    expect(r.total).toMatchObject({ current: 32_300, previous: 26_140, average3: 23_996.67 })
    expect(r.total.deltaPrevious).toBeCloseTo(6_160 / 26_140, 10)
    expect(r.total.deltaAverage3).toBeCloseTo((32_300 - 23_996.67) / 23_996.67, 10)
  })

  it('CMV, prime cost e metas', () => {
    expect(r.cmv.amount).toBe(14_000)
    expect(r.cmv.pctOfRevenue).toBeCloseTo(14_000 / 45_000, 10)
    expect(r.cmv.target).toEqual({ min: 0.28, max: 0.35 })
    expect(r.primeCost).toMatchObject({ amount: 20_000, cmv: 14_000, labor: 6_000, targetMax: 0.65 })
    expect(r.primeCost.pctOfRevenue).toBeCloseTo(20_000 / 45_000, 10)
  })

  it('taxa de plataforma', () => {
    expect(r.platformFee).toMatchObject({ amount: 2_900, previous: 1_840, deliveryRevenue: 15_000 })
    expect(r.platformFee.deltaPrevious).toBeCloseTo(1_060 / 1_840, 10)
    expect(r.platformFee.pctOfDelivery).toBeCloseTo(2_900 / 15_000, 10)
  })

  it('quebra por comportamento com misto separado; histórico de 6 meses', () => {
    expect(r.byBehavior).toEqual({ fixed: 12_200, variable: 18_600, mixed: 1_500 })
    expect(r.history).toEqual([
      { month: '2026-03', total: 0 }, { month: '2026-04', total: 0 }, { month: '2026-05', total: 23_350 },
      { month: '2026-06', total: 22_500 }, { month: '2026-07', total: 26_140 }, { month: M, total: 32_300 },
    ])
  })

  it('itens na ordem, com anterior e média', () => {
    expect(r.items.map((i) => [i.name, i.amount, i.previous, i.average3])).toEqual([
      ['Exp · CMV', 14_000, 10_000, 9_500],
      ['Exp · Pró-labore', 6_000, 6_000, 6_000],
      ['Exp · Aluguel', 4_000, 4_000, 4_000],
      ['Taxa iFood', 2_300, 1_840, 996.67],
      ['Exp · Impostos', 2_200, 1_800, 1_700],
      ['Exp · Utilidades', 1_500, 1_200, 1_200],
      ['Exp · Motoboy', 900, 0, 0],
      ['Exp · Marketing', 800, 1_000, 500],
      ['Taxa Rappi', 600, 0, 0],
      ['Exp · Antiga', 0, 300, 100],
    ])
  })

  it('variações e % da receita por item', () => {
    expect(byName(r, 'Exp · CMV').deltaPrevious).toBeCloseTo(0.4, 10)
    expect(byName(r, 'Exp · CMV').deltaAverage3).toBeCloseTo(4_500 / 9_500, 10)
    expect(byName(r, 'Exp · CMV').pctOfRevenue).toBeCloseTo(14_000 / 45_000, 10)
    expect(byName(r, 'Exp · Marketing')).toMatchObject({ deltaPrevious: -0.2, deltaAverage3: 0.6 })
    expect(byName(r, 'Exp · Motoboy')).toMatchObject({ deltaPrevious: null, deltaAverage3: null })
    expect(byName(r, 'Exp · Antiga')).toMatchObject({ deltaPrevious: -1, deltaAverage3: -1, pctOfRevenue: 0 })
  })

  it('metadados: taxa por conta, imposto no total, categoria apagada', () => {
    expect(byName(r, 'Taxa iFood')).toMatchObject({ key: 'platformFee:exp-ifood', kind: 'platformFee', categoryId: null, behavior: CategoryBehavior.Variable, dreGroup: null })
    expect(byName(r, 'Exp · Impostos')).toMatchObject({ kind: 'category', categoryId: 'imp', dreGroup: DreGroup.Tax, behavior: CategoryBehavior.Fixed })
    expect(byName(r, 'Exp · Antiga')).toMatchObject({ categoryId: 'old', behavior: CategoryBehavior.Fixed, dreGroup: DreGroup.Opex })
  })
})

describe('computeExpenses — filtro de canal', () => {
  it('Delivery: só o canal efetivo delivery; shared fica de fora e é informado', () => {
    const r = scenario(MovementChannel.Delivery)
    expect(r).toMatchObject({ channel: 'delivery', sharedExcluded: 25_700, revenue: { current: 15_000, previous: 8_000 } })
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([['Taxa iFood', 2_300], ['Exp · CMV', 2_000], ['Exp · Motoboy', 900], ['Exp · Marketing', 800], ['Taxa Rappi', 600]])
    expect(r.total).toMatchObject({ current: 6_600, previous: 1_840 })
    expect(r.cmv.pctOfRevenue).toBeCloseTo(2_000 / 15_000, 10)
    expect(r.primeCost).toMatchObject({ amount: 2_000, labor: 0 })
    expect(r.byBehavior).toEqual({ fixed: 0, variable: 6_600, mixed: 0 })
  })

  it('Salão: sem despesas próprias; taxa e receita delivery zeradas', () => {
    const r = scenario(MovementChannel.DineIn)
    expect(r).toMatchObject({ channel: 'dineIn', sharedExcluded: 25_700, items: [], revenue: { current: 30_000 } })
    expect(r.total.current).toBe(0)
    expect(r.platformFee).toMatchObject({ amount: 0, deliveryRevenue: 0, pctOfDelivery: null })
  })

  it('entrada de plataforma marcada dineIn leva a taxa para o salão', () => {
    const rows: ExpenseRow[] = [{ month: M, direction: 'in', categoryId: 'ven', categoryName: 'Vendas', accountId: 'p1', accountName: 'iFood', accountType: 'platform', channel: 'dineIn', gross: 1_000, fee: 120 }]
    const dineIn = scenario(MovementChannel.DineIn, { rows })
    const delivery = scenario(MovementChannel.Delivery, { rows })
    expect(dineIn.platformFee.amount).toBe(120)
    expect(dineIn.platformFee.deliveryRevenue).toBe(0)
    expect(delivery.platformFee.amount).toBe(0)
  })
})

describe('computeExpenses — bordas', () => {
  it('restaurante novo, sem nada: zeros, médias e variações null', () => {
    const r = scenario(null, { rows: [], firstMonth: null })
    expect(r.items).toEqual([])
    expect(r.total).toEqual({ current: 0, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null })
    expect(r.cmv.pctOfRevenue).toBeNull()
    expect(r.primeCost.pctOfRevenue).toBeNull()
    expect(r.platformFee.pctOfDelivery).toBeNull()
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })

  it('primeiro lançamento em M−1: média só desse mês', () => {
    const r = scenario(null, { firstMonth: addMonths(M, -1) })
    expect(r.total.average3).toBe(26_140)
    expect(byName(r, 'Exp · CMV').average3).toBe(10_000)
  })

  it('primeiro lançamento em M: média null', () => {
    const r = scenario(null, { firstMonth: M })
    expect(r.total.average3).toBeNull()
    expect(byName(r, 'Exp · CMV')).toMatchObject({ average3: null, deltaAverage3: null })
  })

  it('despesa sem receita no mês: % da receita null', () => {
    const rows: ExpenseRow[] = [{ month: M, direction: 'out', categoryId: 'cmv', categoryName: 'CMV', accountId: 'c', accountName: 'Caixa', accountType: 'cash', channel: null, gross: 500, fee: 0 }]
    const r = scenario(null, { rows })
    expect(r.cmv).toMatchObject({ amount: 500, pctOfRevenue: null })
    expect(r.items[0].pctOfRevenue).toBeNull()
  })

  it('conta de plataforma renomeada: nome atual; apagada: nome gravado', () => {
    const r = scenario(null, { accountNames: new Map([['exp-ifood', 'iFood Loja 2']]) })
    expect(r.items.map((i) => i.name)).toContain('Taxa iFood Loja 2')
    expect(r.items.map((i) => i.name)).toContain('Taxa Rappi')
  })

  it('categoria reclassificada vale para o passado (classificação atual)', () => {
    const categories = expensesScenarioCategories()
    categories.set('mkt', { ...categories.get('mkt')!, behavior: CategoryBehavior.Fixed })
    const r = scenario(null, { categories })
    expect(r.byBehavior).toEqual({ fixed: 13_000, variable: 17_800, mixed: 1_500 })
    expect(byName(r, 'Exp · Marketing').behavior).toBe(CategoryBehavior.Fixed)
  })

  it('categoria sem dreGroup conta como opex (fora do CMV)', () => {
    const categories = expensesScenarioCategories()
    categories.set('cmv', { name: 'Exp · CMV', behavior: CategoryBehavior.Variable })
    const r = scenario(null, { categories })
    expect(r.cmv.amount).toBe(0)
    expect(byName(r, 'Exp · CMV').dreGroup).toBe(DreGroup.Opex)
  })
})
