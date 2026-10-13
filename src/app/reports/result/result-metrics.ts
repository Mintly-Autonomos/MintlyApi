import { CategoryBehavior, DreGroup, ResultLineKey, ResultLines, TaxRegime } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { buildTaxProfile } from '../../tax/tax-rules'

/**
 * Regra pura do Resultado (DRE, fatia 4). Somas em centavos. A classificação vem
 * da categoria ATUAL (corrigir a categoria corrige o histórico — T7 da fatia 3).
 * Spec: specs/modulos-novos/20261012/resultado-dre.md.
 */

/** N8 decidida na fatia 4: despesa mista conta como fixa no ponto de equilíbrio. */
export const MIXED_BEHAVIOR_AS: CategoryBehavior.Fixed | CategoryBehavior.Variable = CategoryBehavior.Fixed
export const HISTORY_MONTHS = 6
export const PLATFORM_FEE_NAME = 'Taxa de plataforma'

export interface MonthlyTotalRow {
  month: string
  direction: 'in' | 'out'
  categoryId: string
  categoryName: string
  gross: number
  fee: number
}

export interface CategoryInfo {
  id: string
  name: string
  dreGroup?: DreGroup
  behavior: CategoryBehavior
}

/** Imposto de um mês: alíquota (Simples) ou valor fixo (MEI); os dois null = sem regime. */
export interface MonthTax {
  effectiveRate: number | null
  fixedAmount: number | null
}

export interface CategoryAmount {
  categoryId: string
  name: string
  kind: 'labor' | 'opex'
  behavior: CategoryBehavior
  cents: number
}

/** Um mês somado, em centavos. */
export interface MonthAggregate {
  grossRevenue: number
  platformFee: number
  cmv: number
  opexCategories: Map<string, CategoryAmount>
  fixed: number
  variable: number
}

const effectiveBehavior = (b: CategoryBehavior) => (b === CategoryBehavior.Mixed ? MIXED_BEHAVIOR_AS : b)

/**
 * Soma um mês: entradas viram receita bruta e taxa de plataforma; saídas são
 * classificadas pela categoria atual — `cmv`, `labor`, `tax` (fora do DRE) ou
 * `opex` (inclusive sem grupo). Categoria que não existe mais vira opex com o
 * nome do lançamento e conta como fixa (leitura conservadora).
 */
export function aggregateMonth (rows: MonthlyTotalRow[], month: string, categories: Map<string, CategoryInfo>): MonthAggregate {
  const agg: MonthAggregate = { grossRevenue: 0, platformFee: 0, cmv: 0, opexCategories: new Map(), fixed: 0, variable: 0 }

  for (const r of rows) {
    if (r.month !== month) continue
    if (r.direction === 'in') {
      agg.grossRevenue += toCents(r.gross)
      agg.platformFee += toCents(r.fee)
      continue
    }

    const category = categories.get(r.categoryId)
    if (category?.dreGroup === DreGroup.Tax) continue

    const cents = toCents(r.gross)
    const behavior = category?.behavior ?? CategoryBehavior.Fixed
    if (category?.dreGroup === DreGroup.Cmv) {
      agg.cmv += cents
    } else {
      const current = agg.opexCategories.get(r.categoryId) ?? {
        categoryId: r.categoryId,
        name: category?.name ?? r.categoryName,
        kind: category?.dreGroup === DreGroup.Labor ? 'labor' : 'opex',
        behavior,
        cents: 0,
      }
      current.cents += cents
      agg.opexCategories.set(r.categoryId, current)
    }

    if (effectiveBehavior(behavior) === CategoryBehavior.Fixed) agg.fixed += cents
    else agg.variable += cents
  }

  agg.variable += agg.platformFee
  return agg
}

export function hasActivity (agg: MonthAggregate): boolean {
  return agg.grossRevenue > 0 || agg.cmv > 0 || agg.platformFee > 0 || agg.opexCategories.size > 0
}

/**
 * Imposto do mês (M5): Simples → alíquota efetiva do `buildTaxProfile`; MEI → DAS
 * vigente, só a partir do mês da primeira movimentação (antes disso o restaurante
 * não existia no Mintly — sem prejuízo fantasma no histórico); sem regime → nada.
 */
export function monthTax (p: { regime: TaxRegime | null; month: string; firstMonth: string | null; revenueByMonth: Map<string, number>; meiMonthlyDas: number | null }): MonthTax {
  if (p.regime == null) return { effectiveRate: null, fixedAmount: null }
  if (p.regime === TaxRegime.Mei) {
    const active = p.firstMonth != null && p.firstMonth <= p.month
    return { effectiveRate: null, fixedAmount: active ? (p.meiMonthlyDas ?? 0) : 0 }
  }
  const profile = buildTaxProfile({ regime: p.regime, referenceMonth: p.month, firstMonth: p.firstMonth, revenueByMonth: p.revenueByMonth, meiMonthlyDas: null })
  return { effectiveRate: profile.effectiveRate, fixedAmount: null }
}

/** Linhas do DRE de um mês (spec, "Linhas de um mês"). */
export function buildLines (agg: MonthAggregate, tax: MonthTax): ResultLines {
  const taxes = tax.effectiveRate != null ? Math.round(agg.grossRevenue * tax.effectiveRate) : toCents(tax.fixedAmount ?? 0)
  let opex = agg.platformFee
  for (const c of agg.opexCategories.values()) opex += c.cents

  const netRevenue = agg.grossRevenue - taxes
  const grossMargin = netRevenue - agg.cmv
  const netProfit = grossMargin - opex

  return {
    grossRevenue: fromCents(agg.grossRevenue),
    taxes: fromCents(taxes),
    netRevenue: fromCents(netRevenue),
    cmv: fromCents(agg.cmv),
    grossMargin: fromCents(grossMargin),
    operatingExpenses: fromCents(opex),
    netProfit: fromCents(netProfit),
    netMargin: agg.grossRevenue > 0 ? netProfit / agg.grossRevenue : null,
  }
}

/** Variação relativa; o módulo faz um prejuízo menor aparecer como melhora. */
export function relativeDelta (current: number, previous: number): number | null {
  if (previous === 0) return null
  return (current - previous) / Math.abs(previous)
}

const LINE_KEYS: ResultLineKey[] = ['grossRevenue', 'taxes', 'netRevenue', 'cmv', 'grossMargin', 'operatingExpenses', 'netProfit']

export function buildDeltas (current: ResultLines, previous: ResultLines): Record<ResultLineKey, number | null> {
  return Object.fromEntries(LINE_KEYS.map((k) => [k, relativeDelta(current[k], previous[k])])) as Record<ResultLineKey, number | null>
}
