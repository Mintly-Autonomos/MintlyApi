import { describe, expect, it } from 'vitest'
import { buildTaxHistory, typicalDas } from './tax-history'
import { computeRbt12 } from './tax-rules'

const rev = (e: [string, number][]) => new Map(e)

describe('typicalDas (reteste 22/11, T1: DAS fixo do MEI)', () => {
  it('mediana de cada pagamento: dois DAS no mesmo mês não dobram o valor', () => {
    expect(typicalDas([2539.61, 2539.62, 2539.61])).toBe(2539.61)
    expect(typicalDas([80, 82])).toBe(81)
    expect(typicalDas([])).toBeNull()
    expect(typicalDas([0, -5])).toBeNull()
  })
})

describe('buildTaxHistory (reteste 22/11, T2: início da atividade)', () => {
  it('sem abertura informada: o 1º mês é o da primeira venda', () => {
    const h = buildTaxHistory({ firstRevenueMonth: '2025-12', revenueByMonth: rev([['2025-12', 25_245]]) })
    expect(h.firstMonth).toBe('2025-12')
    expect(h.unknownMonths.size).toBe(0)
  })

  it('empresa aberta antes do Mintly: o faturamento informado entra no RBT12 e o mês sem valor fica fora da média', () => {
    const h = buildTaxHistory({
      firstRevenueMonth: '2025-12',
      revenueByMonth: rev([['2025-12', 30_000]]),
      activityStart: '2025-08',
      revenueBeforeMintly: [
        { month: '2025-09', amount: 20_000 },
        { month: '2025-10', amount: 22_000 },
        { month: '2025-11', amount: 24_000 },
        // Mês com venda no Mintly: vale o lançado.
        { month: '2025-12', amount: 1 },
      ],
    })
    expect(h.firstMonth).toBe('2025-08')
    expect([...h.unknownMonths]).toEqual(['2025-08'])
    expect(h.revenueByMonth.get('2025-12')).toBe(30_000)
    // Dez/25: 4 meses de atividade antes, 1 desconhecido → (20.000 + 22.000 + 24.000) ÷ 3 × 12.
    const r = computeRbt12({ referenceMonth: '2025-12', firstMonth: h.firstMonth, revenueByMonth: h.revenueByMonth, unknownMonths: h.unknownMonths })
    expect(r).toMatchObject({ rbt12: 264_000, monthsOfHistory: 4, proportional: true })
  })

  it('abertura depois da primeira venda (digitada errado): vale a primeira venda', () => {
    const h = buildTaxHistory({ firstRevenueMonth: '2025-12', revenueByMonth: rev([]), activityStart: '2026-03' })
    expect(h.firstMonth).toBe('2025-12')
  })
})
