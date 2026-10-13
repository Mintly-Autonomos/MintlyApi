import { CategoryBehavior, DreGroup, ExpenseItem, FinancialAccountType, ExpenseItemKind, ExpensesReport, MovementChannel } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { addMonths } from '../shared/period'
import { effectiveChannel } from '../shared/channel'

/**
 * Custos & Despesas, fatia A (spec 20261013/custos-despesas.md) — regras puras.
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
  gross: number
  fee: number
}

export interface ExpenseCategoryInfo {
  name: string
  behavior: CategoryBehavior
  dreGroup?: DreGroup
}

export interface ExpensesInput {
  referenceMonth: string
  channel: MovementChannel | null
  rows: ExpenseRow[]
  categories: Map<string, ExpenseCategoryInfo>
  accountNames: Map<string, string>
  firstMonth: string | null
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
}

const emptyBucket = (): MonthBucket => ({ revenue: 0, deliveryRevenue: 0, platformRevenue: 0, shared: 0, items: new Map() })

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
  const add = (b: MonthBucket, meta: ItemMeta, cents: number) => {
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
        }, toCents(r.fee))
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
    }, toCents(r.gross))
  }
  return { buckets, metas }
}

export function computeExpenses (input: ExpensesInput): ExpensesReport {
  const M = input.referenceMonth
  const P = addMonths(M, -1)
  const { buckets, metas } = bucketize(input)
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

  const items: ExpenseItem[] = []
  for (const meta of metas.values()) {
    const amount = cur.items.get(meta.key) ?? 0
    const previous = prev.items.get(meta.key) ?? 0
    const avg = average((b) => b.items.get(meta.key) ?? 0)
    if (amount === 0 && previous === 0 && !avg) continue
    items.push({
      ...meta,
      amount: fromCents(amount),
      previous: fromCents(previous),
      average3: money(avg),
      deltaPrevious: delta(amount, previous),
      deltaAverage3: delta(amount, avg),
      pctOfRevenue: share(amount, cur.revenue),
    })
  }
  items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))

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
    history: Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(M, i - (HISTORY_MONTHS - 1))).map((m) => ({ month: m, total: fromCents(total(at(m))) })),
  }
}
