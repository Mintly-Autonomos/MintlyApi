import { CategoryBehavior, DreGroup, ExpenseAnomaly, ExpenseItem, ExpenseItemKind, ExpenseSubitem, ExpensesReport, FinancialAccountType, MovementChannel } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { addMonths } from '../shared/period'
import { effectiveChannel } from '../shared/channel'
import { ANOMALY_RULE, NO_SUBITEM_KEY, NO_SUBITEM_NAME, isAnomaly, project, projectionWindow, sortSubitems } from './expenses-detail'

/**
 * Custos & Despesas, fatias A e B (specs 20261013/custos-despesas.md e
 * custos-despesas-b.md) — regras puras.
 * Somas em centavos; a média de 3 meses só conta meses desde o primeiro lançamento.
 */
export const HISTORY_MONTHS = 6
/** Alvos de benchmark fechados pela MIN-84. */
export const CMV_TARGET = { min: 0.28, max: 0.35 }
export const PRIME_COST_TARGET_MAX = 0.65

/** Linha agregada do repositório: mês × direção × categoria × canal gravado × conta. */
export interface ExpenseRow {
  month: string
  direction: 'in' | 'out'
  categoryId: string
  categoryName: string
  accountId: string
  accountName: string
  accountType: string
  channel: string | null
  /** Fatia 7: subcategoria gravada no lançamento (null = sem). */
  subcategoryId: string | null
  subcategoryName: string | null
  gross: number
  fee: number
  /** Parte de `gross`/`fee` com data depois de hoje (lançamento futuro do mês); ausente = 0. */
  grossAfter?: number
  feeAfter?: number
}

export interface ExpenseCategoryInfo {
  name: string
  behavior: CategoryBehavior
  dreGroup?: DreGroup
  /** Nomes atuais das subcategorias (fatia 7). */
  subcategories?: { _id: string; name: string }[]
}

export interface ExpensesInput {
  referenceMonth: string
  channel: MovementChannel | null
  rows: ExpenseRow[]
  categories: Map<string, ExpenseCategoryInfo>
  accountNames: Map<string, string>
  firstMonth: string | null
  /** Agora — define se há projeção (mês atual em SP). */
  today: Date
}

interface SubMeta {
  key: string
  subcategoryId: string | null
  name: string
}

interface ItemMeta {
  key: string
  kind: ExpenseItemKind
  categoryId: string | null
  name: string
  behavior: CategoryBehavior
  dreGroup: DreGroup | null
}

/** Um mês, em centavos, já filtrado pelo canal. */
interface MonthBucket {
  revenue: number
  deliveryRevenue: number
  /** Σ bruto das entradas em conta de plataforma — base do % da taxa (decisão A). */
  platformRevenue: number
  shared: number
  items: Map<string, number>
  /** Parte de `items` com data depois de hoje — fica fora da base da projeção. */
  itemsAfter: Map<string, number>
  /** Fatia 7: categoria → subitem → centavos. */
  subs: Map<string, Map<string, number>>
}

const emptyBucket = (): MonthBucket => ({ revenue: 0, deliveryRevenue: 0, platformRevenue: 0, shared: 0, items: new Map(), itemsAfter: new Map(), subs: new Map() })

/** Filtro da tela: só salão ou delivery — `shared` não é filtro (vai em `sharedExcluded`). */
export function parseExpensesChannel (value: unknown): MovementChannel | null {
  if (value == null || value === '') return null
  if (value === MovementChannel.DineIn || value === MovementChannel.Delivery) return value
  throw new ValidationError('channel inválido: use dineIn ou delivery.')
}

const delta = (current: number, base: number | null): number | null => (base == null || base === 0 ? null : (current - base) / base)
const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole)
const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0)

function bucketize (input: ExpensesInput) {
  const buckets = new Map<string, MonthBucket>()
  const metas = new Map<string, ItemMeta>()
  const subMetas = new Map<string, Map<string, SubMeta>>()
  const withSubcategory = new Set<string>()
  const add = (b: MonthBucket, meta: ItemMeta, cents: number, afterCents: number) => {
    b.itemsAfter.set(meta.key, (b.itemsAfter.get(meta.key) ?? 0) + afterCents)
    if (!metas.has(meta.key)) metas.set(meta.key, meta)
    b.items.set(meta.key, (b.items.get(meta.key) ?? 0) + cents)
  }

  for (const r of input.rows) {
    const channel = effectiveChannel({ direction: r.direction, account: { type: r.accountType }, channel: r.channel })
    const passes = input.channel == null || channel === input.channel
    const b = buckets.get(r.month) ?? emptyBucket()
    buckets.set(r.month, b)

    if (r.direction === 'in') {
      if (!passes) continue
      b.revenue += toCents(r.gross)
      if (channel === MovementChannel.Delivery) b.deliveryRevenue += toCents(r.gross)
      if (r.accountType === FinancialAccountType.Platform) b.platformRevenue += toCents(r.gross)
      // M6: a taxa é linha sintética, uma por conta de plataforma, no canal da entrada.
      if (r.fee > 0) {
        add(b, {
          key: `platformFee:${r.accountId}`,
          kind: 'platformFee',
          categoryId: null,
          name: `Taxa ${input.accountNames.get(r.accountId) ?? r.accountName}`,
          behavior: CategoryBehavior.Variable,
          dreGroup: null,
        }, toCents(r.fee), toCents(r.feeAfter ?? 0))
      }
      continue
    }

    if (!passes) {
      if (channel === MovementChannel.Shared) b.shared += toCents(r.gross)
      continue
    }
    const category = input.categories.get(r.categoryId)
    add(b, {
      key: r.categoryId,
      kind: 'category',
      categoryId: r.categoryId,
      name: category?.name ?? r.categoryName,
      // Categoria apagada: leitura conservadora, como no DRE.
      behavior: category?.behavior ?? CategoryBehavior.Fixed,
      dreGroup: category?.dreGroup ?? DreGroup.Opex,
    }, toCents(r.gross), toCents(r.grossAfter ?? 0))

    // Fatia 7: acumula também por subitem; "Sem subitem" quando o lançamento não tem.
    const subKey = r.subcategoryId ?? NO_SUBITEM_KEY
    if (r.subcategoryId) withSubcategory.add(r.categoryId)
    const metasOfCategory = subMetas.get(r.categoryId) ?? new Map<string, SubMeta>()
    subMetas.set(r.categoryId, metasOfCategory)
    if (!metasOfCategory.has(subKey)) {
      metasOfCategory.set(subKey, {
        key: subKey,
        subcategoryId: r.subcategoryId,
        name: r.subcategoryId
          ? (category?.subcategories?.find((s) => s._id === r.subcategoryId)?.name ?? r.subcategoryName ?? '')
          : NO_SUBITEM_NAME,
      })
    }
    const subsOfCategory = b.subs.get(r.categoryId) ?? new Map<string, number>()
    b.subs.set(r.categoryId, subsOfCategory)
    subsOfCategory.set(subKey, (subsOfCategory.get(subKey) ?? 0) + toCents(r.gross))
  }
  return { buckets, metas, subMetas, withSubcategory }
}

export function computeExpenses (input: ExpensesInput): ExpensesReport {
  const M = input.referenceMonth
  const P = addMonths(M, -1)
  const { buckets, metas, subMetas, withSubcategory } = bucketize(input)
  const at = (m: string) => buckets.get(m) ?? emptyBucket()
  const cur = at(M)
  const prev = at(P)

  const eligible = [1, 2, 3].map((i) => addMonths(M, -i)).filter((m) => input.firstMonth != null && m >= input.firstMonth)
  const average = (f: (b: MonthBucket) => number): number | null =>
    eligible.length === 0 ? null : Math.round(sum(eligible.map((m) => f(at(m)))) / eligible.length)
  const money = (cents: number | null) => (cents == null ? null : fromCents(cents))
  const total = (b: MonthBucket) => sum(b.items.values())
  const sumWhere = (b: MonthBucket, pred: (meta: ItemMeta) => boolean) =>
    sum([...b.items].filter(([key]) => pred(metas.get(key)!)).map(([, cents]) => cents))

  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(M, i - (HISTORY_MONTHS - 1)))
  const window = projectionWindow(M, input.today)
  // Projeção: só o que já aconteceu é extrapolado; o que está lançado para depois
  // de hoje no mês (aluguel do dia 25) entra pelo valor cheio, sem multiplicar.
  const projectWithScheduled = (cents: number, afterCents: number) => project(cents - afterCents, window!) + afterCents
  const measure = (get: (b: MonthBucket) => number) => ({ amount: get(cur), previous: get(prev), avg: average(get) })
  const anomalies: ExpenseAnomaly[] = []
  // Base da anomalia (decisão A da revisão): os meses elegíveis contam a partir do
  // primeiro mês em que AQUELA unidade (subitem ou categoria) teve gasto na janela —
  // quem começou a marcar "Frango" há 1 mês não tem histórico de zeros para comparar.
  // A média exibida no item/subitem segue a regra da fatia 6.
  const unitBase = (get: (b: MonthBucket) => number): { avg: number | null; months: number } => {
    const firstSpend = months.find((m) => get(at(m)) > 0)
    const unitMonths = firstSpend == null ? [] : eligible.filter((m) => m >= firstSpend)
    if (unitMonths.length === 0) return { avg: null, months: 0 }
    return { avg: Math.round(sum(unitMonths.map((m) => get(at(m)))) / unitMonths.length), months: unitMonths.length }
  }
  const anomalyOf = (meta: ItemMeta, sub: SubMeta | null, amount: number, avg: number): ExpenseAnomaly => ({
    itemKey: meta.key,
    categoryId: meta.categoryId,
    categoryName: meta.name,
    subcategoryId: sub?.subcategoryId ?? null,
    subitemKey: sub?.key ?? null,
    name: sub?.name ?? meta.name,
    amount: fromCents(amount),
    average3: fromCents(avg),
    excess: fromCents(amount - avg),
    pctAbove: (amount - avg) / avg,
  })

  const items: ExpenseItem[] = []
  for (const meta of metas.values()) {
    const get = (b: MonthBucket) => b.items.get(meta.key) ?? 0
    const { amount, previous, avg } = measure(get)
    if (amount === 0 && previous === 0 && !avg) continue

    // Fatia 7 (B2): com subitens, avalia cada um; sem, a categoria inteira; taxa nunca.
    let subitems: ExpenseSubitem[] = []
    let hasAnomaly = false
    if (meta.kind === 'category' && withSubcategory.has(meta.key)) {
      for (const sub of subMetas.get(meta.key)!.values()) {
        const getSub = (b: MonthBucket) => b.subs.get(meta.key)?.get(sub.key) ?? 0
        const s = measure(getSub)
        if (s.amount === 0 && s.previous === 0 && !s.avg) continue
        const base = unitBase(getSub)
        const anomaly = isAnomaly(s.amount, base.avg, base.months)
        if (anomaly) {
          hasAnomaly = true
          anomalies.push(anomalyOf(meta, sub, s.amount, base.avg!))
        }
        subitems.push({
          key: sub.key,
          subcategoryId: sub.subcategoryId,
          name: sub.name,
          amount: fromCents(s.amount),
          previous: fromCents(s.previous),
          average3: money(s.avg),
          deltaPrevious: delta(s.amount, s.previous),
          deltaAverage3: delta(s.amount, s.avg),
          anomaly,
        })
      }
      subitems = sortSubitems(subitems)
    } else if (meta.kind === 'category') {
      const base = unitBase(get)
      if (isAnomaly(amount, base.avg, base.months)) {
        hasAnomaly = true
        anomalies.push(anomalyOf(meta, null, amount, base.avg!))
      }
    }

    items.push({
      ...meta,
      amount: fromCents(amount),
      previous: fromCents(previous),
      average3: money(avg),
      deltaPrevious: delta(amount, previous),
      deltaAverage3: delta(amount, avg),
      pctOfRevenue: share(amount, cur.revenue),
      subitems,
      hasAnomaly,
      history: months.map((m) => ({ month: m, amount: fromCents(get(at(m))) })),
      projected: window ? fromCents(projectWithScheduled(amount, cur.itemsAfter.get(meta.key) ?? 0)) : null,
    })
  }
  items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))
  anomalies.sort((a, b) => b.excess - a.excess || a.name.localeCompare(b.name, 'pt-BR'))

  const totalCur = total(cur)
  const totalPrev = total(prev)
  const totalAvg = average(total)
  const cmv = sumWhere(cur, (m) => m.dreGroup === DreGroup.Cmv)
  const labor = sumWhere(cur, (m) => m.dreGroup === DreGroup.Labor)
  const isFee = (m: ItemMeta) => m.kind === 'platformFee'
  const fee = sumWhere(cur, isFee)
  const feePrev = sumWhere(prev, isFee)
  const behavior = (b: CategoryBehavior) => fromCents(sumWhere(cur, (m) => m.behavior === b))

  // % da taxa (decisão A, 13/10/2026): sobre o bruto das contas de plataforma —
  // a taxa e a venda que a gerou ficam no mesmo denominador, mesmo que o dono
  // tenha marcado outro canal; a venda própria marcada delivery não paga taxa.
  return {
    referenceMonth: M,
    previousMonth: P,
    channel: input.channel,
    revenue: { current: fromCents(cur.revenue), previous: fromCents(prev.revenue) },
    total: {
      current: fromCents(totalCur),
      previous: fromCents(totalPrev),
      average3: money(totalAvg),
      deltaPrevious: delta(totalCur, totalPrev),
      deltaAverage3: delta(totalCur, totalAvg),
    },
    cmv: { amount: fromCents(cmv), pctOfRevenue: share(cmv, cur.revenue), target: CMV_TARGET },
    primeCost: { amount: fromCents(cmv + labor), cmv: fromCents(cmv), labor: fromCents(labor), pctOfRevenue: share(cmv + labor, cur.revenue), targetMax: PRIME_COST_TARGET_MAX },
    platformFee: { amount: fromCents(fee), previous: fromCents(feePrev), deltaPrevious: delta(fee, feePrev), deliveryRevenue: fromCents(cur.deliveryRevenue), pctOfDelivery: share(fee, cur.platformRevenue) },
    byBehavior: { fixed: behavior(CategoryBehavior.Fixed), variable: behavior(CategoryBehavior.Variable), mixed: behavior(CategoryBehavior.Mixed) },
    items,
    sharedExcluded: input.channel == null ? null : fromCents(cur.shared),
    history: months.map((m) => ({ month: m, total: fromCents(total(at(m))) })),
    anomalies,
    projection: window ? { total: fromCents(projectWithScheduled(totalCur, sum(cur.itemsAfter.values()))), ...window } : null,
    anomalyRule: ANOMALY_RULE,
  }
}
