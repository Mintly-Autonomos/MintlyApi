import { describe, expect, it } from 'vitest'
import { TaxRegime } from 'mintly-lib'
import { SIMPLES_ANEXO_I, bracketFor, buildTaxProfile, computeRbt12, effectiveRate, meiCap, saleTax } from './tax-rules'
import { addMonths } from '../reports/shared/period'

describe('bracketFor — Anexo I, limites inclusivos', () => {
  it('180.000,00 é faixa 1; 180.000,01 é faixa 2', () => {
    expect(bracketFor(180000).index).toBe(1)
    expect(bracketFor(180000.01).index).toBe(2)
  })

  it('cada limite superior pertence à própria faixa', () => {
    for (const b of SIMPLES_ANEXO_I) expect(bracketFor(b.upTo).index).toBe(b.index)
  })

  it('acima de 4,8 mi fica na faixa 6', () => {
    expect(bracketFor(5_000_000).index).toBe(6)
  })
})

describe('effectiveRate — (RBT12 × nominal − dedução) / RBT12', () => {
  it.each([
    [100_000, 0.04],
    [300_000, (300_000 * 0.073 - 5_940) / 300_000],
    [500_000, (500_000 * 0.095 - 13_860) / 500_000],
    [1_000_000, (1_000_000 * 0.107 - 22_500) / 1_000_000],
    [2_000_000, (2_000_000 * 0.143 - 87_300) / 2_000_000],
    [4_000_000, (4_000_000 * 0.19 - 378_000) / 4_000_000],
  ])('RBT12 %d', (rbt12, expected) => {
    expect(effectiveRate(rbt12)).toBeCloseTo(expected, 10)
  })

  it('RBT12 500.000 → 6,728%', () => {
    expect(effectiveRate(500_000)).toBeCloseTo(0.06728, 10)
  })

  it('RBT12 zero: nominal da faixa 1, sem dividir por zero', () => {
    expect(effectiveRate(0)).toBe(0.04)
  })
})

describe('saleTax', () => {
  it('Simples: alíquota efetiva × valor, em centavos', () => {
    expect(saleTax(1234.56, TaxRegime.SimplesNacionalAnexoI, { rbt12: 500_000, meiMonthlyDas: null }))
      .toEqual({ kind: 'variable', effectiveRate: effectiveRate(500_000), tax: 83.06 })
  })

  it('MEI: DAS fixo do mês (ou null sem configuração)', () => {
    expect(saleTax(1000, TaxRegime.Mei, { rbt12: 0, meiMonthlyDas: 81.05 })).toEqual({ kind: 'fixed', monthlyDas: 81.05 })
    expect(saleTax(1000, TaxRegime.Mei, { rbt12: 0, meiMonthlyDas: null })).toEqual({ kind: 'fixed', monthlyDas: null })
  })
})

const rev = (entries: Array<[string, number]>) => new Map(entries)

describe('computeRbt12', () => {
  it('12 meses ou mais: soma dos 12 anteriores', () => {
    const months = Array.from({ length: 13 }, (_, i) => [`2025-${String(i + 1).padStart(2, '0')}`, 10_000] as [string, number])
    const r = computeRbt12({ referenceMonth: '2026-02', firstMonth: '2025-01', revenueByMonth: rev([...months.slice(0, 12), ['2026-01', 20_000]]) })
    expect(r).toEqual({ rbt12: 11 * 10_000 + 20_000, monthsOfHistory: 13, proportional: false })
  })

  it('primeiro mês de atividade: receita do mês × 12', () => {
    expect(computeRbt12({ referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 5_000]]) }))
      .toEqual({ rbt12: 60_000, monthsOfHistory: 0, proportional: true })
  })

  it('1 a 11 meses: média dos meses anteriores × 12', () => {
    expect(computeRbt12({ referenceMonth: '2026-10', firstMonth: '2026-07', revenueByMonth: rev([['2026-07', 9_000], ['2026-08', 12_000], ['2026-09', 15_000], ['2026-10', 99_999]]) }))
      .toEqual({ rbt12: 144_000, monthsOfHistory: 3, proportional: true })
  })

  it('sem nenhuma movimentação: zero', () => {
    expect(computeRbt12({ referenceMonth: '2026-10', firstMonth: null, revenueByMonth: rev([]) }))
      .toEqual({ rbt12: 0, monthsOfHistory: 0, proportional: true })
  })
})

describe('meiCap', () => {
  it('teto cheio quando começou em ano anterior; acumulado de janeiro até o mês', () => {
    expect(meiCap({ referenceMonth: '2026-03', firstMonth: '2025-05', revenueByMonth: rev([['2025-12', 9_999], ['2026-01', 10_000], ['2026-02', 20_000], ['2026-03', 30_000]]) }))
      .toEqual({ annualLimit: 81_000, yearToDateRevenue: 60_000, usedPct: 60_000 / 81_000 })
  })

  // LC 123, art. 18-A §2º: no ano de início, 6.750 × meses do início da
  // atividade até o FIM do ano-calendário (setembro → 4 meses).
  it('ano de início: teto proporcional (6.750 × meses do início até dezembro)', () => {
    expect(meiCap({ referenceMonth: '2026-10', firstMonth: '2026-09', revenueByMonth: rev([['2026-09', 5_000], ['2026-10', 5_000]]) }))
      .toEqual({ annualLimit: 27_000, yearToDateRevenue: 10_000, usedPct: 10_000 / 27_000 })
  })

  it('mês anterior à primeira movimentação: teto cheio, sem divisão por zero nem teto negativo', () => {
    expect(meiCap({ referenceMonth: '2026-09', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 5_000]]) }))
      .toEqual({ annualLimit: 81_000, yearToDateRevenue: 0, usedPct: 0 })
    expect(meiCap({ referenceMonth: '2026-08', firstMonth: '2026-10', revenueByMonth: rev([]) }).annualLimit).toBe(81_000)
  })
})

describe('buildTaxProfile', () => {
  const twelveFlat = (value: number, last: number) => {
    const entries: Array<[string, number]> = []
    for (let i = 13; i >= 2; i--) entries.push([addMonths('2026-10', -i), value])
    entries.push([addMonths('2026-10', -1), last])
    return rev(entries)
  }

  it('sem regime: só o RBT12 e o aviso de não configurado', () => {
    const p = buildTaxProfile({ regime: null, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 1_000]]), meiMonthlyDas: null })
    expect(p).toEqual({
      regime: null,
      referenceMonth: '2026-10',
      rbt12: 12_000,
      monthsOfHistory: 0,
      rbt12Proportional: true,
      effectiveRate: null,
      bracket: null,
      previousBracketIndex: null,
      meiMonthlyDas: null,
      meiCap: null,
      insights: [{ kind: 'taxRegimeNotConfigured', severity: 'info' }],
    })
  })

  it('Simples cruzando da faixa 2 para a 3: bracketChanged', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2025-09', revenueByMonth: twelveFlat(29_000, 45_000), meiMonthlyDas: null })
    expect(p).toMatchObject({ rbt12: 364_000, monthsOfHistory: 13, rbt12Proportional: false, bracket: { index: 3 }, previousBracketIndex: 2 })
    expect(p.effectiveRate).toBeCloseTo(20_720 / 364_000, 10)
    expect(p.insights).toEqual([{
      kind: 'bracketChanged',
      severity: 'warning',
      fromBracket: 2,
      toBracket: 3,
      fromRate: effectiveRate(348_000),
      toRate: effectiveRate(364_000),
      rbt12: 364_000,
    }])
  })

  it('Simples sem troca de faixa: sem insight', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2025-09', revenueByMonth: twelveFlat(10_000, 10_000), meiMonthlyDas: null })
    expect(p.insights).toEqual([])
    expect(p.previousBracketIndex).toBe(1)
  })

  it('Simples no primeiro mês: sem faixa anterior', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([]), meiMonthlyDas: null })
    expect(p).toMatchObject({ rbt12: 0, effectiveRate: 0.04, bracket: { index: 1 }, previousBracketIndex: null, insights: [] })
  })

  it('Simples acima de 4,8 mi: simplesLimitExceeded', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2025-01', revenueByMonth: twelveFlat(410_000, 410_000), meiMonthlyDas: null })
    expect(p.insights).toContainEqual({ kind: 'simplesLimitExceeded', severity: 'warning', rbt12: 4_920_000 })
  })

  it('MEI: DAS do mês, teto e meiCapNear a partir de 80%', () => {
    // aberto em outubro: teto do ano = 6.750 × 3 (out, nov, dez) = 20.250
    const near = buildTaxProfile({ regime: TaxRegime.Mei, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 16_200]]), meiMonthlyDas: 81.05 })
    expect(near).toMatchObject({ meiMonthlyDas: 81.05, effectiveRate: null, bracket: null, meiCap: { annualLimit: 20_250, yearToDateRevenue: 16_200, usedPct: 0.8 } })
    expect(near.insights).toEqual([{ kind: 'meiCapNear', severity: 'warning', usedPct: 0.8, yearToDateRevenue: 16_200, annualLimit: 20_250 }])

    const below = buildTaxProfile({ regime: TaxRegime.Mei, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 16_179.75]]), meiMonthlyDas: null })
    expect(below.insights).toEqual([])
  })
})
