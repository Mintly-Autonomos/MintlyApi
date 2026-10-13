import { toDecimal128 } from '../../core/money/money'
import { addMonths, startOfLocalMonth } from '../reports/shared/period'

/**
 * Cenário tributário determinístico, relativo ao mês de referência M. Uma
 * entrada por mês, no dia 1 ao meio-dia local (nunca no futuro):
 *   M-13 … M-2: R$ 29.000 cada (12 meses) → RBT12(M-1) = 348.000 (faixa 2)
 *   M-1:        R$ 45.000                 → RBT12(M)   = 11 × 29.000 + 45.000 = 364.000 (faixa 3)
 *   M:          R$ 30.000                 (não entra no RBT12 de M)
 * Alíquota de M = (364.000 × 9,5% − 13.860) / 364.000 = 20.720 / 364.000.
 * Usado pelo teste de integração e por `SEED_SCENARIO=tax npm run db:seed-demo`.
 */
export const TAX_SEED_MARKER = 'seed-demo:tax'

export interface TaxScenarioRefs {
  restaurantId: string
  account: { _id: string; name: string; type: string }
  revenueCategory: { _id: string; name: string }
}

const MONTHLY: Array<[number, number]> = [
  ...Array.from({ length: 12 }, (_, i) => [-(13 - i), 29_000] as [number, number]),
  [-1, 45_000],
  [0, 30_000],
]

export function taxScenarioMovements (referenceMonth: string, refs: TaxScenarioRefs): Record<string, unknown>[] {
  return MONTHLY.map(([offset, value]) => {
    const month = addMonths(referenceMonth, offset)
    const money = toDecimal128(value)
    return {
      restaurantId: refs.restaurantId,
      title: `Vendas ${month}`,
      direction: 'in',
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(month).getTime() + 12 * 60 * 60 * 1000),
      grossValue: money,
      feeValue: toDecimal128(0),
      netValue: money,
      account: refs.account,
      category: { ...refs.revenueCategory, type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      description: TAX_SEED_MARKER,
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
    }
  })
}

/** O que o perfil Simples TEM que mostrar para o cenário acima. */
export const TAX_SCENARIO_EXPECTED = {
  rbt12: 364_000,
  monthsOfHistory: 13,
  rbt12Proportional: false,
  bracketIndex: 3,
  previousBracketIndex: 2,
  effectiveRate: 20_720 / 364_000,
  previousRate: 19_464 / 348_000,
}
