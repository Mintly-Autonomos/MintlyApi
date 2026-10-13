import { RestaurantTaxProfile, TaxBracket, TaxInsight, TaxRegime } from 'mintly-lib'
import { fromCents, toCents } from '../../core/money/money'
import { addMonths, diffMonths } from '../reports/shared/period'

/**
 * Regra tributária (M5 / MIN-23) — pura. Nomes da MIN-23: `calcAliquotaEfetiva`
 * → `effectiveRate`; `calcImpostoVenda` → `saleTax`.
 */

/** Anexo I (Comércio) do Simples Nacional — inalterado desde 2018, confirmado para 2026 (MIN-23). */
export const SIMPLES_ANEXO_I: readonly TaxBracket[] = [
  { index: 1, upTo: 180_000, nominalRate: 0.04, deduction: 0 },
  { index: 2, upTo: 360_000, nominalRate: 0.073, deduction: 5_940 },
  { index: 3, upTo: 720_000, nominalRate: 0.095, deduction: 13_860 },
  { index: 4, upTo: 1_800_000, nominalRate: 0.107, deduction: 22_500 },
  { index: 5, upTo: 3_600_000, nominalRate: 0.143, deduction: 87_300 },
  { index: 6, upTo: 4_800_000, nominalRate: 0.19, deduction: 378_000 },
]

/** Acima disto a empresa sai do Simples (insight `simplesLimitExceeded`). */
export const SIMPLES_LIMIT = 4_800_000
/** Teto anual do MEI e o mensal usado no ano de início (proporcional). */
export const MEI_ANNUAL_LIMIT = 81_000
export const MEI_MONTHLY_LIMIT = 6_750
/** Alerta de proximidade do teto do MEI (MIN-23: "a partir de 80%"). */
export const MEI_CAP_WARNING_PCT = 0.8

/** Faixa do RBT12 — limite superior inclusivo; acima do limite do Simples, faixa 6. */
export function bracketFor (rbt12: number): TaxBracket {
  return SIMPLES_ANEXO_I.find((b) => rbt12 <= b.upTo) ?? SIMPLES_ANEXO_I[SIMPLES_ANEXO_I.length - 1]
}

/** MIN-23 `calcAliquotaEfetiva`. RBT12 0 (sem venda) → nominal da faixa 1. */
export function effectiveRate (rbt12: number): number {
  if (rbt12 <= 0) return SIMPLES_ANEXO_I[0].nominalRate
  const b = bracketFor(rbt12)
  return (rbt12 * b.nominalRate - b.deduction) / rbt12
}

export type SaleTax =
  | { kind: 'fixed'; monthlyDas: number | null }
  | { kind: 'variable'; effectiveRate: number; tax: number }

/**
 * MIN-23 `calcImpostoVenda`. MEI paga DAS fixo (não varia com a venda); Simples
 * paga a alíquota efetiva sobre o valor, arredondada em centavos. É o que o DRE
 * (fatia 4) consome.
 */
export function saleTax (value: number, regime: TaxRegime, p: { rbt12: number; meiMonthlyDas: number | null }): SaleTax {
  if (regime === TaxRegime.Mei) return { kind: 'fixed', monthlyDas: p.meiMonthlyDas }
  const rate = effectiveRate(p.rbt12)
  return { kind: 'variable', effectiveRate: rate, tax: fromCents(Math.round(toCents(value) * rate)) }
}

const cents = (n: number) => toCents(n)

/**
 * RBT12 do mês de referência (MIN-23): receita bruta dos 12 meses civis
 * anteriores. Menos de 12 meses de histórico (LC 123, art. 18): no primeiro mês
 * de atividade, a receita do próprio mês × 12; de 1 a 11 meses, a média dos
 * meses anteriores × 12. Somas em centavos.
 */
export function computeRbt12 (p: { referenceMonth: string; firstMonth: string | null; revenueByMonth: Map<string, number> }) {
  const revenueOf = (month: string) => cents(p.revenueByMonth.get(month) ?? 0)
  const monthsOfHistory = p.firstMonth == null ? 0 : Math.max(0, diffMonths(p.firstMonth, p.referenceMonth))

  if (monthsOfHistory === 0) {
    return { rbt12: fromCents(revenueOf(p.referenceMonth) * 12), monthsOfHistory, proportional: true }
  }

  const window = Math.min(12, monthsOfHistory)
  let sum = 0
  for (let i = 1; i <= window; i++) sum += revenueOf(addMonths(p.referenceMonth, -i))

  if (monthsOfHistory >= 12) return { rbt12: fromCents(sum), monthsOfHistory, proportional: false }
  return { rbt12: fromCents(Math.round((sum / window) * 12)), monthsOfHistory, proportional: true }
}

/**
 * Teto do MEI no ano do mês de referência: R$ 81.000; no ano de início (LC 123,
 * art. 18-A §2º), R$ 6.750 × meses do início da atividade até o FIM do
 * ano-calendário. Mês anterior à primeira movimentação não é ano de início
 * "ativo": teto cheio, sem divisão por zero. `usedPct` = receita de janeiro até
 * o mês ÷ teto.
 */
export function meiCap (p: { referenceMonth: string; firstMonth: string | null; revenueByMonth: Map<string, number> }) {
  const year = p.referenceMonth.slice(0, 4)
  let ytd = 0
  for (let m = `${year}-01`; m <= p.referenceMonth; m = addMonths(m, 1)) ytd += cents(p.revenueByMonth.get(m) ?? 0)

  const startedThisYear = p.firstMonth != null && p.firstMonth.slice(0, 4) === year && p.firstMonth <= p.referenceMonth
  const annualLimit = startedThisYear
    ? MEI_MONTHLY_LIMIT * (diffMonths(p.firstMonth!, `${year}-12`) + 1)
    : MEI_ANNUAL_LIMIT
  const yearToDateRevenue = fromCents(ytd)
  return { annualLimit, yearToDateRevenue, usedPct: yearToDateRevenue / annualLimit }
}

/** Perfil tributário do mês — o que o GET /restaurants/me devolve e o DRE consome. */
export function buildTaxProfile (p: {
  regime: TaxRegime | null
  referenceMonth: string
  firstMonth: string | null
  revenueByMonth: Map<string, number>
  meiMonthlyDas: number | null
}): RestaurantTaxProfile {
  const current = computeRbt12(p)
  const profile: RestaurantTaxProfile = {
    regime: p.regime,
    referenceMonth: p.referenceMonth,
    rbt12: current.rbt12,
    monthsOfHistory: current.monthsOfHistory,
    rbt12Proportional: current.proportional,
    effectiveRate: null,
    bracket: null,
    previousBracketIndex: null,
    meiMonthlyDas: null,
    meiCap: null,
    insights: [],
  }

  if (p.regime == null) {
    profile.insights.push({ kind: 'taxRegimeNotConfigured', severity: 'info' })
    return profile
  }

  if (p.regime === TaxRegime.Mei) {
    const cap = meiCap(p)
    profile.meiMonthlyDas = p.meiMonthlyDas
    profile.meiCap = cap
    if (cap.usedPct >= MEI_CAP_WARNING_PCT) {
      profile.insights.push({ kind: 'meiCapNear', severity: 'warning', usedPct: cap.usedPct, yearToDateRevenue: cap.yearToDateRevenue, annualLimit: cap.annualLimit })
    }
    return profile
  }

  const bracket = bracketFor(current.rbt12)
  profile.effectiveRate = effectiveRate(current.rbt12)
  profile.bracket = { ...bracket }

  if (current.monthsOfHistory >= 1) {
    const previous = computeRbt12({ ...p, referenceMonth: addMonths(p.referenceMonth, -1) })
    const previousBracket = bracketFor(previous.rbt12)
    profile.previousBracketIndex = previousBracket.index
    if (previousBracket.index !== bracket.index) {
      const insight: TaxInsight = {
        kind: 'bracketChanged',
        severity: 'warning',
        fromBracket: previousBracket.index,
        toBracket: bracket.index,
        fromRate: effectiveRate(previous.rbt12),
        toRate: profile.effectiveRate,
        rbt12: current.rbt12,
      }
      profile.insights.push(insight)
    }
  }

  if (current.rbt12 > SIMPLES_LIMIT) {
    profile.insights.push({ kind: 'simplesLimitExceeded', severity: 'warning', rbt12: current.rbt12 })
  }
  return profile
}
