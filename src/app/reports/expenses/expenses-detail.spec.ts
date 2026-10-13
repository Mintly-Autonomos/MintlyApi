import { describe, expect, it } from 'vitest'
import { ExpenseSubitem } from 'mintly-lib'
import { ANOMALY_RULE, daysInMonth, isAnomaly, project, projectionWindow, sortSubitems } from './expenses-detail'

describe('isAnomaly (centavos)', () => {
  it('exatamente +50% (excedente R$ 1.000) com 2 meses → sim', () => expect(isAnomaly(300_000, 200_000, 2)).toBe(true))
  it('excedente exatamente R$ 100 (+100%) → sim', () => expect(isAnomaly(20_000, 10_000, 3)).toBe(true))
  it('+49,9% com excedente R$ 998 → não', () => expect(isAnomaly(299_800, 200_000, 3)).toBe(false))
  it('excedente R$ 99,99 → não, mesmo com +100%', () => expect(isAnomaly(19_998, 9_999, 3)).toBe(false))
  it('só 1 mês elegível → não', () => expect(isAnomaly(100_000, 10_000, 1)).toBe(false))
  it('média 0 ou null → não', () => {
    expect(isAnomaly(100_000, 0, 3)).toBe(false)
    expect(isAnomaly(100_000, null, 3)).toBe(false)
  })
  it('regra exposta', () => expect(ANOMALY_RULE).toEqual({ minPctAbove: 0.5, minExcess: 100, minHistoryMonths: 2 }))
})

describe('projeção', () => {
  it('dias do mês', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-08')).toBe(31)
  })
  it('mês atual → dia de hoje em SP (inclusive)', () => {
    expect(projectionWindow('2026-08', new Date('2026-08-10T15:00:00Z'))).toEqual({ elapsedDays: 10, daysInMonth: 31 })
  })
  it('22h do último dia em SP (já dia 1 em UTC) ainda é o mês', () => {
    expect(projectionWindow('2026-08', new Date('2026-09-01T01:00:00Z'))).toEqual({ elapsedDays: 31, daysInMonth: 31 })
  })
  it('mês fechado → null', () => {
    expect(projectionWindow('2026-08', new Date('2026-09-01T03:30:00Z'))).toBeNull()
    expect(projectionWindow('2026-07', new Date('2026-08-10T15:00:00Z'))).toBeNull()
  })
  it('projeta linear, arredondando ao centavo', () => {
    expect(project(3_230_000, { elapsedDays: 10, daysInMonth: 31 })).toBe(10_013_000)
    expect(project(100, { elapsedDays: 3, daysInMonth: 31 })).toBe(1_033)
    expect(project(500, { elapsedDays: 31, daysInMonth: 31 })).toBe(500)
  })
})

describe('sortSubitems', () => {
  const sub = (key: string, name: string, amount: number): ExpenseSubitem => ({ key, subcategoryId: key === 'none' ? null : key, name, amount, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null, anomaly: false })
  it('valor desc., nome; "Sem subitem" sempre por último', () => {
    const sorted = sortSubitems([sub('none', 'Sem subitem', 9_000), sub('a', 'Óleo', 100), sub('b', 'Frango', 500), sub('c', 'Embalagens', 100)])
    expect(sorted.map((s) => s.name)).toEqual(['Frango', 'Embalagens', 'Óleo', 'Sem subitem'])
  })
})
