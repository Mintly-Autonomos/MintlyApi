import { CategoryBehavior, DreGroup, OperationalNature, OpexItem, ResultBreakEven, ResultInsight, ResultLineKey, ResultLines, ResultReport, TaxRegime } from 'mintly-lib'
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
/** O Resultado aceita até 12 meses à frente (só o já lançado com competência no mês; U.4). */
export const MAX_FUTURE_MONTHS = 12
export const PLATFORM_FEE_NAME = 'Taxa de plataforma'
/** S3.3: taxa das contas plataforma do tipo maquininha, em linha própria. */
export const CARD_FEE_NAME = 'Taxa da maquininha'

export interface MonthlyTotalRow {
  month: string
  direction: 'in' | 'out'
  categoryId: string
  categoryName: string
  /** S3.3: entrada numa conta maquininha (a taxa vai para `cardFee`). */
  cardMachine?: boolean
  gross: number
  fee: number
  /** Ajuste A1: soma até o dia de corte (mesmo período); ausente = mês cheio. */
  grossUntil?: number
  feeUntil?: number
}

export interface CategoryInfo {
  id: string
  name: string
  dreGroup?: DreGroup
  behavior: CategoryBehavior
  /** "Não operacional": fica fora da receita e das despesas (linhas próprias depois do resultado). */
  operationalNature?: OperationalNature
  /** Categoria do sistema (transferência entre contas, saldo inicial): fora do DRE inteiro (S3.2). */
  systemKey?: string
}

/** Imposto de um mês: alíquota (Simples) ou valor fixo (MEI); os dois null = sem regime. */
export interface MonthTax {
  effectiveRate: number | null
  fixedAmount: number | null
  /** MEI: o DAS fixo foi estimado pelos DAS pagos (sem o valor configurado). */
  estimated?: boolean
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
  /** Comissão dos apps de delivery. */
  platformFee: number
  /** Taxa das maquininhas (S3.3). */
  cardFee: number
  cmv: number
  opexCategories: Map<string, CategoryAmount>
  fixed: number
  variable: number
  /** Entradas e saídas de categorias "Não operacional" (empréstimo, aporte, equipamento...). */
  nonOperatingIncome: number
  nonOperatingExpenses: number
  /** Pagamentos em categoria de imposto (DAS). Nunca é gasto novo: quita o imposto do DRE (ou é ele, no MEI). */
  taxPaid: number
}

const isNonOperating = (category: CategoryInfo | undefined) => category?.operationalNature === OperationalNature.NonOperational

const effectiveBehavior = (b: CategoryBehavior) => (b === CategoryBehavior.Mixed ? MIXED_BEHAVIOR_AS : b)

/**
 * Soma um mês: entradas viram receita bruta e taxa de plataforma; saídas são
 * classificadas pela categoria atual — `cmv`, `labor`, `tax` (fora do DRE) ou
 * `opex` (inclusive sem grupo). Categoria que não existe mais vira opex com o
 * nome do lançamento e conta como fixa (leitura conservadora). Categoria "Não
 * operacional" (nos dois sentidos) não é venda nem custo: vai só para
 * `nonOperatingIncome`/`nonOperatingExpenses`.
 */
export function aggregateMonth (rows: MonthlyTotalRow[], month: string, categories: Map<string, CategoryInfo>): MonthAggregate {
  const agg: MonthAggregate = { grossRevenue: 0, platformFee: 0, cardFee: 0, cmv: 0, opexCategories: new Map(), fixed: 0, variable: 0, nonOperatingIncome: 0, nonOperatingExpenses: 0, taxPaid: 0 }

  for (const r of rows) {
    if (r.month !== month) continue
    // Transferência entre contas e saldo inicial não são resultado nenhum: nem operacional, nem não operacional.
    if (categories.get(r.categoryId)?.systemKey) continue
    // Reteste 18/11, item 2: o pagamento do imposto (grupo "tax") não é despesa nova nem "não operacional",
    // mesmo que a categoria esteja marcada assim — senão o DAS conta duas vezes no Simples.
    if (r.direction === 'out' && categories.get(r.categoryId)?.dreGroup === DreGroup.Tax) {
      agg.taxPaid += toCents(r.gross)
      continue
    }
    if (isNonOperating(categories.get(r.categoryId))) {
      if (r.direction === 'in') agg.nonOperatingIncome += toCents(r.gross)
      else agg.nonOperatingExpenses += toCents(r.gross)
      continue
    }
    if (r.direction === 'in') {
      agg.grossRevenue += toCents(r.gross)
      if (r.cardMachine) agg.cardFee += toCents(r.fee)
      else agg.platformFee += toCents(r.fee)
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

  agg.variable += agg.platformFee + agg.cardFee
  return agg
}

export function hasActivity (agg: MonthAggregate): boolean {
  return agg.grossRevenue > 0 || agg.cmv > 0 || agg.platformFee > 0 || agg.cardFee > 0 || [...agg.opexCategories.values()].some((c) => c.cents > 0)
}

/**
 * Imposto do mês (M5): Simples → alíquota efetiva do `buildTaxProfile`; MEI → DAS
 * vigente, só a partir do mês da primeira movimentação (antes disso o restaurante
 * não existia no Mintly — sem prejuízo fantasma no histórico); sem regime → nada.
 */
export function monthTax (p: { regime: TaxRegime | null; month: string; firstMonth: string | null; revenueByMonth: Map<string, number>; meiMonthlyDas: number | null; meiDasEstimated?: boolean; unknownMonths?: ReadonlySet<string> }): MonthTax {
  if (p.regime == null) return { effectiveRate: null, fixedAmount: null }
  if (p.regime === TaxRegime.Mei) {
    const active = p.firstMonth != null && p.firstMonth <= p.month
    if (!active) return { effectiveRate: null, fixedAmount: 0 }
    // Reteste 22/11 (T1): o DAS é um valor FIXO por mês: o configurado ou, sem ele, o DAS típico dos pagamentos.
    // Antes, sem configuração, o imposto era o DAS pago no mês (2 DAS em novembro dobravam o imposto).
    return p.meiMonthlyDas != null && p.meiMonthlyDas > 0
      ? { effectiveRate: null, fixedAmount: p.meiMonthlyDas, ...(p.meiDasEstimated ? { estimated: true } : {}) }
      : { effectiveRate: null, fixedAmount: 0 }
  }
  const profile = buildTaxProfile({ regime: p.regime, referenceMonth: p.month, firstMonth: p.firstMonth, revenueByMonth: p.revenueByMonth, meiMonthlyDas: null, unknownMonths: p.unknownMonths })
  return { effectiveRate: profile.effectiveRate, fixedAmount: null }
}

/** Linhas do DRE de um mês (spec, "Linhas de um mês"). */
export function buildLines (agg: MonthAggregate, tax: MonthTax): ResultLines {
  const taxes = tax.effectiveRate != null
    ? Math.round(agg.grossRevenue * tax.effectiveRate)
    : toCents(tax.fixedAmount ?? 0)
  let opex = agg.platformFee + agg.cardFee
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
    nonOperatingIncome: fromCents(agg.nonOperatingIncome),
    nonOperatingExpenses: fromCents(agg.nonOperatingExpenses),
    resultAfterNonOperating: fromCents(netProfit + agg.nonOperatingIncome - agg.nonOperatingExpenses),
  }
}

/** Variação relativa; o módulo faz um prejuízo menor aparecer como melhora. */
export function relativeDelta (current: number, previous: number): number | null {
  if (previous === 0) return null
  return (current - previous) / Math.abs(previous)
}

const LINE_KEYS: ResultLineKey[] = ['grossRevenue', 'taxes', 'netRevenue', 'cmv', 'grossMargin', 'operatingExpenses', 'netProfit', 'nonOperatingIncome', 'nonOperatingExpenses', 'resultAfterNonOperating']

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
    // Zerada nos dois lados (ex.: no mês atual, gasto do anterior caiu depois do
    // dia de corte): linha vazia, fora da composição.
    if ((c?.cents ?? 0) === 0 && (p?.cents ?? 0) === 0) continue
    const base = (c ?? p)!
    items.push(opexItem({ categoryId: base.categoryId, name: base.name, kind: base.kind, behavior: base.behavior }, c?.cents ?? 0, p?.cents ?? 0, current.grossRevenue))
  }
  if (current.platformFee > 0 || previous.platformFee > 0) {
    items.push(opexItem({ categoryId: null, name: PLATFORM_FEE_NAME, kind: 'platformFee', behavior: CategoryBehavior.Variable }, current.platformFee, previous.platformFee, current.grossRevenue))
  }
  if (current.cardFee > 0 || previous.cardFee > 0) {
    items.push(opexItem({ categoryId: null, name: CARD_FEE_NAME, kind: 'cardFee', behavior: CategoryBehavior.Variable }, current.cardFee, previous.cardFee, current.grossRevenue))
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
  /** Ajuste A1: no mês atual, o dia de hoje (SP) — a comparação usa os mesmos dias. */
  untilDay?: number | null
  /** Meses do `history` (6 ou 12; padrão 6). As linhas `rows` precisam cobrir também o mês −12. */
  historyMonths?: number
}

const NO_TAX: MonthTax = { effectiveRate: null, fixedAmount: null }

/** O relatório inteiro a partir das somas, das categorias e do imposto de cada mês. */
export function computeResult (input: ResultInput): ResultReport {
  const n = input.historyMonths ?? HISTORY_MONTHS
  const months = Array.from({ length: n }, (_, i) => addMonths(input.referenceMonth, i - (n - 1)))
  const previousMonth = addMonths(input.referenceMonth, -1)
  const previousYearMonth = addMonths(input.referenceMonth, -12)
  // Ajuste A1: no mês atual, o anterior é comparado pelos mesmos dias (1..untilDay)
  // — senão o mês pela metade sempre "cai". O histórico segue com meses cheios.
  const untilDay = input.untilDay ?? null
  const comparisonRows = untilDay == null ? input.rows : input.rows.map((r) => ({ ...r, gross: r.grossUntil ?? r.gross, fee: r.feeUntil ?? r.fee }))
  // Reteste 18/11, itens 3 e 8: o mês EM ANDAMENTO é mostrado até hoje (o mesmo corte da comparação). Antes o
  // valor exibido somava o agendado até o fim do mês e a variação não, e a "Leitura do mês" dava outra margem.
  const aggs = new Map(months.map((m) => [m, aggregateMonth(untilDay != null && m === input.referenceMonth ? comparisonRows : input.rows, m, input.categories)]))
  const linesOf = (m: string) => buildLines(aggs.get(m)!, input.taxByMonth.get(m) ?? NO_TAX)
  const current = linesOf(input.referenceMonth)
  const currentAgg = aggs.get(input.referenceMonth)!
  const previousAgg = aggregateMonth(comparisonRows, previousMonth, input.categories)
  const previous = buildLines(previousAgg, input.taxByMonth.get(previousMonth) ?? NO_TAX)
  const currentCmp = current
  const items = buildOpexItems(currentAgg, previousAgg)
  // U.4: mesmo mês do ano anterior, com o mesmo corte de dias do mês anterior no mês em andamento.
  const previousYearAgg = aggregateMonth(comparisonRows, previousYearMonth, input.categories)
  const previousYearLines = buildLines(previousYearAgg, input.taxByMonth.get(previousYearMonth) ?? NO_TAX)
  const tax = input.taxByMonth.get(input.referenceMonth) ?? NO_TAX

  return {
    referenceMonth: input.referenceMonth,
    previousMonth,
    current,
    previous,
    deltas: buildDeltas(currentCmp, previous),
    tax: {
      regime: input.regime,
      effectiveRate: tax.effectiveRate,
      meiMonthlyDas: input.regime === TaxRegime.Mei ? (tax.fixedAmount ?? input.meiMonthlyDas) : null,
      meiDasEstimated: input.regime === TaxRegime.Mei && tax.estimated === true,
    },
    operatingExpenseItems: items,
    breakEven: buildBreakEven(currentAgg, current, input.referenceMonth, input.dailyRevenue),
    history: months.map((m) => {
      const l = linesOf(m)
      return { month: m, grossRevenue: l.grossRevenue, netProfit: l.netProfit, netMargin: l.netMargin }
    }),
    insights: buildInsights({ regime: input.regime, current: currentCmp, previous, previousHasActivity: hasActivity(previousAgg), items }),
    comparison: untilDay == null ? { kind: 'fullMonth', untilDay: null } : { kind: 'samePeriod', untilDay },
    previousYear: hasActivity(previousYearAgg)
      ? { month: previousYearMonth, lines: previousYearLines, deltas: buildDeltas(currentCmp, previousYearLines) }
      : null,
  }
}
