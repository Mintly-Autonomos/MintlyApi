import { TaxBracket, TaxRegime } from 'mintly-lib'
import { fromCents, toCents } from '../../core/money/money'

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
