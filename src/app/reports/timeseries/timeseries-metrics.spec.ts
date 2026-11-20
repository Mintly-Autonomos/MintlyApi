import { describe, expect, it } from 'vitest'
import { CategoryBehavior, DreGroup, OperationalNature } from 'mintly-lib'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { CategoryInfo, MonthlyTotalRow } from '../result/result-metrics'
import { buckets, computeTimeseries, parseTimeseriesQuery, weekStart } from './timeseries-metrics'

const cats = new Map<string, CategoryInfo>([
  ['ven', { id: 'ven', name: 'Vendas', dreGroup: undefined, behavior: CategoryBehavior.Variable }],
  ['cmv', { id: 'cmv', name: 'Insumos', dreGroup: DreGroup.Cmv, behavior: CategoryBehavior.Variable }],
  ['alu', { id: 'alu', name: 'Aluguel', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Fixed }],
  ['emp', { id: 'emp', name: 'Empréstimo', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.NonOperational }],
])
const row = (day: string, over: Partial<MonthlyTotalRow>): MonthlyTotalRow => ({ month: day, direction: 'out', categoryId: 'x', categoryName: 'x', gross: 0, fee: 0, ...over })

describe('parseTimeseriesQuery (P.3)', () => {
  it('padrões e limites do seletor', () => {
    expect(parseTimeseriesQuery({})).toEqual({ granularity: 'month', points: 12, previousYear: false })
    expect(parseTimeseriesQuery({ granularity: 'day' })).toMatchObject({ points: 30 })
    expect(parseTimeseriesQuery({ granularity: 'day', points: '90' })).toMatchObject({ points: 90 })
    expect(() => parseTimeseriesQuery({ granularity: 'day', points: 91 })).toThrow(ValidationError)
    expect(() => parseTimeseriesQuery({ granularity: 'week', points: 53 })).toThrow(ValidationError)
    expect(() => parseTimeseriesQuery({ granularity: 'ano' })).toThrow(ValidationError)
    expect(parseTimeseriesQuery({ granularity: 'month', compare: 'previousYear' })).toMatchObject({ previousYear: true })
    expect(() => parseTimeseriesQuery({ granularity: 'day', compare: 'previousYear' })).toThrow(ValidationError)
  })
})

describe('buckets', () => {
  it('dia, semana (segunda a domingo, a atual até hoje) e mês (o atual até hoje)', () => {
    expect(buckets('day', 3, '2026-11-20').map((b) => b.key)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20'])
    expect(weekStart('2026-11-20')).toBe('2026-11-16') // sexta → segunda
    expect(weekStart('2026-11-16')).toBe('2026-11-16')
    expect(weekStart('2026-11-22')).toBe('2026-11-16') // domingo
    expect(buckets('week', 2, '2026-11-20')).toEqual([
      { key: '2026-11-09', start: '2026-11-09', end: '2026-11-15' },
      { key: '2026-11-16', start: '2026-11-16', end: '2026-11-20' },
    ])
    expect(buckets('month', 2, '2026-11-20')).toEqual([
      { key: '2026-10', start: '2026-10-01', end: '2026-10-31' },
      { key: '2026-11', start: '2026-11-01', end: '2026-11-20' },
    ])
  })
})

describe('computeTimeseries', () => {
  const rows = [
    row('2026-11-16', { direction: 'in', categoryId: 'ven', gross: 1000, fee: 50 }),
    row('2026-11-17', { direction: 'in', categoryId: 'ven', gross: 3000 }),
    row('2026-11-17', { categoryId: 'cmv', gross: 900 }),
    row('2026-11-18', { categoryId: 'alu', gross: 2000 }),
    row('2026-11-18', { categoryId: 'emp', gross: 700 }), // não operacional: fora do lucro
    row('2026-11-25', { direction: 'in', categoryId: 'ven', gross: 9999 }), // depois de hoje: fora
  ]
  const base = { rows, cash: [], categories: cats, revenueByMonth: new Map([['2026-11', 8000]]), previousYear: false, today: '2026-11-20' }

  it('por dia: o DRE de cada dia, com a mesma classificação do Resultado (sem o não operacional)', () => {
    const r = computeTimeseries({ ...base, granularity: 'day', points: 5, taxByMonth: new Map([['2026-11', { effectiveRate: 0.1, fixedAmount: null }]]) })
    const d17 = r.points.find((p) => p.key === '2026-11-17')!
    expect(d17).toMatchObject({ revenue: 3000, cmv: 900, taxes: 300, expenses: 0, profit: 3000 - 300 - 900 })
    const d16 = r.points.find((p) => p.key === '2026-11-16')!
    expect(d16).toMatchObject({ revenue: 1000, expenses: 50, taxes: 100 }) // taxa de plataforma é despesa
    const d18 = r.points.find((p) => p.key === '2026-11-18')!
    expect(d18).toMatchObject({ expenses: 2000, profit: -2000 })
  })

  it('por semana: soma os dias; valor fixo do imposto (MEI) repartido pela receita do balde no mês', () => {
    const r = computeTimeseries({ ...base, granularity: 'week', points: 1, taxByMonth: new Map([['2026-11', { effectiveRate: null, fixedAmount: 80 }]]) })
    expect(r.points).toHaveLength(1)
    expect(r.points[0]).toMatchObject({ key: '2026-11-16', end: '2026-11-20', revenue: 4000, cmv: 900, expenses: 2050 })
    expect(r.points[0].taxes).toBe(40) // 4.000 de 8.000 no mês → metade do DAS de 80
  })

  it('por mês com o ano anterior: os mesmos meses 12 meses antes', () => {
    const r = computeTimeseries({
      ...base,
      rows: [...rows, row('2025-11-10', { direction: 'in', categoryId: 'ven', gross: 5000 })],
      granularity: 'month',
      points: 2,
      previousYear: true,
      taxByMonth: new Map(),
    })
    expect(r.points.map((p) => p.key)).toEqual(['2026-10', '2026-11'])
    expect(r.previousYear!.map((p) => p.key)).toEqual(['2025-10', '2025-11'])
    expect(r.previousYear![1].revenue).toBe(5000)
    expect(r.points[1].revenue).toBe(4000)
  })

  it('entradas e saídas pelo caixa, separadas', () => {
    const r = computeTimeseries({
      ...base,
      granularity: 'day',
      points: 2,
      taxByMonth: new Map(),
      cash: [
        { day: '2026-11-20', direction: 'in', value: 950 },
        { day: '2026-11-20', direction: 'out', value: 300 },
        { day: '2026-11-19', direction: 'out', value: 100 },
      ],
    })
    expect(r.points.map((p) => [p.key, p.cashIn, p.cashOut])).toEqual([
      ['2026-11-19', 0, 100],
      ['2026-11-20', 950, 300],
    ])
  })
})
