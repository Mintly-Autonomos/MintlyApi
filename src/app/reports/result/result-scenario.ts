import { ObjectId } from 'mongodb'
import { toDecimal128 } from '../../../core/money/money'
import { addMonths, startOfLocalMonth } from '../shared/period'

/**
 * Cenário do Resultado (DRE), relativo ao mês M (P = M−1), regime Simples.
 * Primeira movimentação em P → RBT12(M) = RBT12(P) = 33.000 × 12 = 396.000 →
 * alíquota 6% (faixa 3: (396.000 × 9,5% − 13.860) / 396.000).
 *
 *   M: receita 58.400 (20.000 dia 1 + 20.000 dia 10 + delivery 18.400 dia 20, taxa 6.044)
 *      CMV 21.024 · Pró-labore 8.000 · Aluguel 6.000 · Utilidades 2.200 (misto) · Contador 1.456
 *      Manutenção 1.400 · Taxas de cartão 1.200 · Marketing 1.200 · Simples (tax) 3.700 → fora
 *      → imposto 3.504 · líquida 54.896 · margem bruta 33.872 · despesas 27.500 · lucro 6.372
 *      → fixos 17.656 · variáveis 30.868 · equilíbrio 40.338,10 · atingido no dia 20
 *   P: receita 33.000 (dia 5) · CMV 14.000 · Pró-labore 8.000 · Aluguel 6.000 · Marketing 900
 *      → imposto 1.980 · lucro 2.120
 */
export const RESULT_SEED_MARKER = 'seed-demo:result'

interface Def { key: string; name: string; type: 'revenue' | 'expense'; dreGroup?: string; behavior: string }
const CATEGORIES: Def[] = [
  { key: 'ven', name: 'Demo · Vendas', type: 'revenue', behavior: 'variable' },
  { key: 'cmv', name: 'Demo · CMV', type: 'expense', dreGroup: 'cmv', behavior: 'variable' },
  { key: 'pro', name: 'Demo · Pró-labore', type: 'expense', dreGroup: 'labor', behavior: 'fixed' },
  { key: 'alu', name: 'Demo · Aluguel', type: 'expense', dreGroup: 'opex', behavior: 'fixed' },
  { key: 'uti', name: 'Demo · Utilidades', type: 'expense', dreGroup: 'opex', behavior: 'mixed' },
  { key: 'con', name: 'Demo · Contador', type: 'expense', dreGroup: 'opex', behavior: 'fixed' },
  { key: 'man', name: 'Demo · Manutenção', type: 'expense', dreGroup: 'opex', behavior: 'variable' },
  { key: 'car', name: 'Demo · Taxas de cartão', type: 'expense', dreGroup: 'opex', behavior: 'variable' },
  { key: 'mkt', name: 'Demo · Marketing', type: 'expense', dreGroup: 'opex', behavior: 'variable' },
  { key: 'imp', name: 'Demo · Impostos', type: 'expense', dreGroup: 'tax', behavior: 'fixed' },
]

interface Line { month: 0 | -1; day: number; key: string; title: string; gross: number; fee?: number; platform?: boolean }
const LINES: Line[] = [
  { month: 0, day: 1, key: 'ven', title: 'Salão', gross: 20_000 },
  { month: 0, day: 10, key: 'ven', title: 'Salão', gross: 20_000 },
  { month: 0, day: 20, key: 'ven', title: 'Delivery', gross: 18_400, fee: 6_044, platform: true },
  { month: 0, day: 3, key: 'cmv', title: 'Insumos', gross: 21_024 },
  { month: 0, day: 5, key: 'pro', title: 'Pró-labore', gross: 8_000 },
  { month: 0, day: 5, key: 'alu', title: 'Aluguel', gross: 6_000 },
  { month: 0, day: 8, key: 'uti', title: 'Luz e água', gross: 2_200 },
  { month: 0, day: 8, key: 'con', title: 'Contador', gross: 1_456 },
  { month: 0, day: 12, key: 'man', title: 'Manutenção', gross: 1_400 },
  { month: 0, day: 15, key: 'car', title: 'Taxas', gross: 1_200 },
  { month: 0, day: 15, key: 'mkt', title: 'Anúncios', gross: 1_200 },
  { month: 0, day: 20, key: 'imp', title: 'DAS Simples', gross: 3_700 },
  { month: -1, day: 5, key: 'ven', title: 'Salão', gross: 33_000 },
  { month: -1, day: 5, key: 'cmv', title: 'Insumos', gross: 14_000 },
  { month: -1, day: 5, key: 'pro', title: 'Pró-labore', gross: 8_000 },
  { month: -1, day: 5, key: 'alu', title: 'Aluguel', gross: 6_000 },
  { month: -1, day: 5, key: 'mkt', title: 'Anúncios', gross: 900 },
]

export function resultScenario (month: string, restaurantId: string) {
  const audit = () => ({ createdAt: new Date(), updatedAt: new Date() })
  const ids = new Map(CATEGORIES.map((c) => [c.key, new ObjectId()]))
  const categories = CATEGORIES.map((c) => ({
    _id: ids.get(c.key)!,
    restaurantId,
    name: c.name,
    type: c.type,
    ...(c.dreGroup ? { dreGroup: c.dreGroup } : {}),
    behavior: c.behavior,
    operationalNature: 'operational',
    status: 'active',
    isSystem: false,
    usage: 0,
    history: [],
    audit: audit(),
  }))
  const byKey = new Map(CATEGORIES.map((c) => [c.key, c]))
  const movements = LINES.map((l) => {
    const m = addMonths(month, l.month)
    const def = byKey.get(l.key)!
    const fee = l.fee ?? 0
    return {
      restaurantId,
      title: l.title,
      direction: def.type === 'revenue' ? 'in' : 'out',
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(m).getTime() + (l.day - 1) * 86_400_000 + 12 * 3_600_000),
      grossValue: toDecimal128(l.gross),
      feeValue: toDecimal128(fee),
      netValue: toDecimal128(l.gross - fee),
      account: l.platform ? { _id: 'demo-ifood', name: 'Demo · iFood', type: 'platform' } : { _id: 'demo-caixa', name: 'Demo · Caixa', type: 'cash' },
      category: { _id: String(ids.get(l.key)), name: def.name, type: def.type },
      paymentMethod: 'pix',
      origin: 'manual',
      description: RESULT_SEED_MARKER,
      history: [],
      audit: audit(),
    }
  })
  return { categories, movements }
}

/** O que GET /reports/result?month=M TEM que devolver para o cenário (regime Simples). */
export function resultScenarioExpected (month: string) {
  return {
    referenceMonth: month,
    previousMonth: addMonths(month, -1),
    current: { grossRevenue: 58_400, taxes: 3_504, netRevenue: 54_896, cmv: 21_024, grossMargin: 33_872, operatingExpenses: 27_500, netProfit: 6_372 },
    previous: { grossRevenue: 33_000, taxes: 1_980, netRevenue: 31_020, cmv: 14_000, grossMargin: 17_020, operatingExpenses: 14_900, netProfit: 2_120 },
    effectiveRate: 0.06,
    itemNames: ['Demo · Pró-labore', 'Taxa de plataforma', 'Demo · Aluguel', 'Demo · Utilidades', 'Demo · Contador', 'Demo · Manutenção', 'Demo · Marketing', 'Demo · Taxas de cartão'],
    breakEven: { fixedCosts: 17_656, variableCosts: 30_868, breakEvenRevenue: 40_338.1, reachedOnDay: 20 },
    insightKinds: ['profitChanged', 'largestOpexItem'],
  }
}
