import { describe, expect, it } from 'vitest'
import { TaxRegime } from 'mintly-lib'
import { SIMPLES_ANEXO_I, bracketFor, effectiveRate, saleTax } from './tax-rules'

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
