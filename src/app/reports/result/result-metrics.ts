import { CategoryBehavior, DreGroup, OpexItem, ResultBreakEven, ResultInsight, ResultLineKey, ResultLines, ResultReport, TaxRegime } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { buildTaxProfile } from '../../tax/tax-rules'
import { addMonths } from '../shared/period'

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

function opexItem (base: { categoryId: string | null; name: string; kind: OpexItem['kind']; behavior: CategoryBehavior }, amountCents: number, previousCents: number, grossRevenueCents: number): OpexItem {
  return {
    ...base,
    amount: fromCents(amountCents),
    previousAmount: fromCents(previousCents),
    delta: relativeDelta(amountCents, previousCents),
    revenuePct: grossRevenueCents > 0 ? amountCents / grossRevenueCents : null,
  }
}

/** Composição das despesas operacionais de M (com o valor de M−1), do maior para o menor. */
export function buildOpexItems (current: MonthAggregate, previous: MonthAggregate): OpexItem[] {
  const ids = new Set([...current.opexCategories.keys(), ...previous.opexCategories.keys()])
  const items: OpexItem[] = []
  for (const id of ids) {
    const c = current.opexCategories.get(id)
    const p = previous.opexCategories.get(id)
    const base = (c ?? p)!
    items.push(opexItem({ categoryId: base.categoryId, name: base.name, kind: base.kind, behavior: base.behavior }, c?.cents ?? 0, p?.cents ?? 0, current.grossRevenue))
  }
  if (current.platformFee > 0 || previous.platformFee > 0) {
    items.push(opexItem({ categoryId: null, name: PLATFORM_FEE_NAME, kind: 'platformFee', behavior: CategoryBehavior.Variable }, current.platformFee, previous.platformFee, current.grossRevenue))
  }
  return items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))
}

function daysInMonth (month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Ponto de equilíbrio de M (spec): a receita BRUTA que paga os custos fixos —
 * é o que o dono compara com o que vende. `contributionMarginPct` é sobre a
 * receita líquida; em receita bruta a margem é (líquida − variáveis) / bruta,
 * então `breakEvenRevenue = fixos × bruta / (líquida − variáveis)`. O dia em que
 * é atingido compara a receita bruta acumulada. Sem margem positiva, nenhuma
 * venda paga os fixos → null.
 */
export function buildBreakEven (agg: MonthAggregate, lines: ResultLines, month: string, dailyRevenue: Map<string, number>): ResultBreakEven {
  const netCents = toCents(lines.netRevenue)
  const contributionCents = netCents - agg.variable
  const contributionMarginPct = netCents > 0 ? contributionCents / netCents : null
  const breakEvenCents = contributionMarginPct != null && contributionMarginPct > 0
    ? Math.round(agg.fixed * agg.grossRevenue / contributionCents)
    : null

  let reachedOnDay: number | null = null
  if (breakEvenCents != null) {
    let accumulated = 0
    for (let d = 1; d <= daysInMonth(month); d++) {
      accumulated += toCents(dailyRevenue.get(`${month}-${String(d).padStart(2, '0')}`) ?? 0)
      if (accumulated >= breakEvenCents) {
        reachedOnDay = d
        break
      }
    }
  }

  return {
    fixedCosts: fromCents(agg.fixed),
    variableCosts: fromCents(agg.variable),
    contributionMarginPct,
    breakEvenRevenue: breakEvenCents == null ? null : fromCents(breakEvenCents),
    reachedOnDay,
  }
}

/** "Leitura do mês" determinística (R2) + aviso de regime não configurado. */
export function buildInsights (p: { regime: TaxRegime | null; current: ResultLines; previous: ResultLines; previousHasActivity: boolean; items: OpexItem[] }): ResultInsight[] {
  const insights: ResultInsight[] = []
  if (p.previousHasActivity && p.current.netProfit !== p.previous.netProfit) {
    const difference = fromCents(toCents(p.current.netProfit) - toCents(p.previous.netProfit))
    insights.push({
      kind: 'profitChanged',
      severity: difference > 0 ? 'positive' : 'warning',
      difference,
      previousProfit: p.previous.netProfit,
      currentProfit: p.current.netProfit,
      previousMargin: p.previous.netMargin,
      currentMargin: p.current.netMargin,
    })
  }
  const largest = p.items.find((i) => i.amount > 0)
  if (largest) insights.push({ kind: 'largestOpexItem', severity: 'warning', name: largest.name, amount: largest.amount, revenuePct: largest.revenuePct })
  if (p.regime == null) insights.push({ kind: 'taxRegimeNotConfigured', severity: 'info' })
  return insights
}

export interface ResultInput {
  referenceMonth: string
  regime: TaxRegime | null
  rows: MonthlyTotalRow[]
  categories: Map<string, CategoryInfo>
  taxByMonth: Map<string, MonthTax>
  meiMonthlyDas: number | null
  dailyRevenue: Map<string, number>
}

const NO_TAX: MonthTax = { effectiveRate: null, fixedAmount: null }

/** O relatório inteiro a partir das somas, das categorias e do imposto de cada mês. */
export function computeResult (input: ResultInput): ResultReport {
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(input.referenceMonth, i - (HISTORY_MONTHS - 1)))
  const previousMonth = addMonths(input.referenceMonth, -1)
  const aggs = new Map(months.map((m) => [m, aggregateMonth(input.rows, m, input.categories)]))
  const linesOf = (m: string) => buildLines(aggs.get(m)!, input.taxByMonth.get(m) ?? NO_TAX)

  const current = linesOf(input.referenceMonth)
  const previous = linesOf(previousMonth)
  const currentAgg = aggs.get(input.referenceMonth)!
  const previousAgg = aggs.get(previousMonth)!
  const items = buildOpexItems(currentAgg, previousAgg)
  const tax = input.taxByMonth.get(input.referenceMonth) ?? NO_TAX

  return {
    referenceMonth: input.referenceMonth,
    previousMonth,
    current,
    previous,
    deltas: buildDeltas(current, previous),
    tax: {
      regime: input.regime,
      effectiveRate: tax.effectiveRate,
      meiMonthlyDas: input.regime === TaxRegime.Mei ? input.meiMonthlyDas : null,
    },
    operatingExpenseItems: items,
    breakEven: buildBreakEven(currentAgg, current, input.referenceMonth, input.dailyRevenue),
    history: months.map((m) => {
      const l = linesOf(m)
      return { month: m, grossRevenue: l.grossRevenue, netProfit: l.netProfit, netMargin: l.netMargin }
    }),
    insights: buildInsights({ regime: input.regime, current, previous, previousHasActivity: hasActivity(previousAgg), items }),
  }
}
