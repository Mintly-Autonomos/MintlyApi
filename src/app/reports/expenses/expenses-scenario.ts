import { ObjectId } from 'mongodb'
import { CategoryBehavior, DreGroup } from 'mintly-lib'
import { toDecimal128 } from '../../../core/money/money'
import { addMonths, startOfLocalMonth } from '../shared/period'
import { ExpenseCategoryInfo, ExpenseRow } from './expenses-metrics'

/**
 * Cenário de Custos & Despesas relativo ao mês M — os números esperados estão no
 * plano (specs/modulos-novos/20261013/plan-custos-despesas.md, "Cenário").
 * Primeiro lançamento em M−3; "Antiga" é categoria apagada (só no lançamento).
 * CMV dividido em Frango/Óleo/Embalagens/Sem subitem (fatia 7).
 */
export const EXPENSES_SEED_MARKER = 'seed-demo:expenses'

interface Def { key: string; name: string; type: 'revenue' | 'expense'; dreGroup?: DreGroup; behavior: CategoryBehavior; subcategories?: { _id: string; name: string }[] }
const CATEGORIES: Def[] = [
  { key: 'ven', name: 'Exp · Vendas', type: 'revenue', behavior: CategoryBehavior.Variable },
  {
    key: 'cmv',
    name: 'Exp · CMV',
    type: 'expense',
    dreGroup: DreGroup.Cmv,
    behavior: CategoryBehavior.Variable,
    subcategories: [{ _id: 'sub-fra', name: 'Frango' }, { _id: 'sub-ole', name: 'Óleo' }, { _id: 'sub-emb', name: 'Embalagens' }],
  },
  { key: 'pro', name: 'Exp · Pró-labore', type: 'expense', dreGroup: DreGroup.Labor, behavior: CategoryBehavior.Fixed },
  { key: 'alu', name: 'Exp · Aluguel', type: 'expense', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Fixed },
  { key: 'uti', name: 'Exp · Utilidades', type: 'expense', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Mixed },
  { key: 'mkt', name: 'Exp · Marketing', type: 'expense', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Variable },
  { key: 'mot', name: 'Exp · Motoboy', type: 'expense', dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Variable },
  { key: 'imp', name: 'Exp · Impostos', type: 'expense', dreGroup: DreGroup.Tax, behavior: CategoryBehavior.Fixed },
]
const DELETED = { key: 'old', name: 'Exp · Antiga' }

type Acc = 'cash' | 'ifood' | 'rappi'
const ACCOUNTS: Record<Acc, { _id: string; name: string; type: string }> = {
  cash: { _id: 'exp-caixa', name: 'Caixa', type: 'cash' },
  ifood: { _id: 'exp-ifood', name: 'iFood', type: 'platform' },
  rappi: { _id: 'exp-rappi', name: 'Rappi', type: 'platform' },
}

interface Line { month: 0 | -1 | -2 | -3; key: string; gross: number; fee?: number; acc?: Acc; channel?: 'delivery'; cancelled?: boolean; sub?: 'sub-fra' | 'sub-ole' | 'sub-emb' }
const LINES: Line[] = [
  { month: 0, key: 'ven', gross: 30_000 },
  { month: 0, key: 'ven', gross: 10_000, fee: 2_300, acc: 'ifood' },
  { month: 0, key: 'ven', gross: 4_000, fee: 600, acc: 'rappi' },
  { month: 0, key: 'ven', gross: 1_000, channel: 'delivery' },
  { month: 0, key: 'pro', gross: 6_000 },
  { month: 0, key: 'alu', gross: 4_000 },
  { month: 0, key: 'uti', gross: 1_500 },
  { month: 0, key: 'mkt', gross: 800, channel: 'delivery' },
  { month: 0, key: 'imp', gross: 2_200 },
  { month: 0, key: 'mot', gross: 900, channel: 'delivery' },
  { month: 0, key: 'cmv', gross: 6_000, sub: 'sub-fra' },
  { month: 0, key: 'cmv', gross: 1_500, sub: 'sub-ole' },
  { month: 0, key: 'cmv', gross: 2_400, sub: 'sub-emb' },
  { month: 0, key: 'cmv', gross: 2_100 },
  { month: 0, key: 'cmv', gross: 2_000, sub: 'sub-emb', channel: 'delivery' },
  { month: -1, key: 'cmv', gross: 5_500, sub: 'sub-fra' },
  { month: -1, key: 'cmv', gross: 1_500, sub: 'sub-ole' },
  { month: -1, key: 'cmv', gross: 1_500, sub: 'sub-emb' },
  { month: -1, key: 'cmv', gross: 1_500 },
  { month: -2, key: 'cmv', gross: 5_000, sub: 'sub-fra' },
  { month: -2, key: 'cmv', gross: 1_400, sub: 'sub-ole' },
  { month: -2, key: 'cmv', gross: 1_600, sub: 'sub-emb' },
  { month: -2, key: 'cmv', gross: 1_500 },
  { month: -3, key: 'cmv', gross: 5_000, sub: 'sub-fra' },
  { month: -3, key: 'cmv', gross: 1_300, sub: 'sub-ole' },
  { month: -3, key: 'cmv', gross: 1_400, sub: 'sub-emb' },
  { month: -3, key: 'cmv', gross: 1_300 },
  { month: 0, key: 'cmv', gross: 500, cancelled: true },
  { month: -1, key: 'ven', gross: 25_000 },
  { month: -1, key: 'ven', gross: 8_000, fee: 1_840, acc: 'ifood' },
  { month: -1, key: 'pro', gross: 6_000 },
  { month: -1, key: 'alu', gross: 4_000 },
  { month: -1, key: 'uti', gross: 1_200 },
  { month: -1, key: 'mkt', gross: 1_000 },
  { month: -1, key: 'old', gross: 300 },
  { month: -1, key: 'imp', gross: 1_800 },
  { month: -2, key: 'ven', gross: 24_000 },
  { month: -2, key: 'pro', gross: 6_000 },
  { month: -2, key: 'alu', gross: 4_000 },
  { month: -2, key: 'uti', gross: 1_300 },
  { month: -2, key: 'imp', gross: 1_700 },
  { month: -3, key: 'ven', gross: 22_000 },
  { month: -3, key: 'ven', gross: 5_000, fee: 1_150, acc: 'ifood' },
  { month: -3, key: 'pro', gross: 6_000 },
  { month: -3, key: 'alu', gross: 4_000 },
  { month: -3, key: 'uti', gross: 1_100 },
  { month: -3, key: 'mkt', gross: 500 },
  { month: -3, key: 'imp', gross: 1_600 },
]

const defOf = (key: string) => CATEGORIES.find((c) => c.key === key)
const nameOf = (key: string) => defOf(key)?.name ?? DELETED.name
const subName = (id?: string) => CATEGORIES.flatMap((c) => c.subcategories ?? []).find((s) => s._id === id)?.name ?? null
const directionOf = (key: string): 'in' | 'out' => (defOf(key)?.type === 'revenue' ? 'in' : 'out')

/** Linhas já agregadas como o repositório devolve (ids = chaves do cenário). Canceladas fora. */
export function expensesScenarioRows (month: string): ExpenseRow[] {
  return LINES.filter((l) => !l.cancelled).map((l) => {
    const acc = ACCOUNTS[l.acc ?? 'cash']
    return {
      month: addMonths(month, l.month),
      direction: directionOf(l.key),
      categoryId: l.key,
      categoryName: nameOf(l.key),
      accountId: acc._id,
      accountName: acc.name,
      accountType: acc.type,
      channel: l.channel ?? null,
      subcategoryId: l.sub ?? null,
      subcategoryName: subName(l.sub),
      gross: l.gross,
      fee: l.fee ?? 0,
    }
  })
}

/** Categorias vivas do cenário por chave ("Antiga" não está — foi apagada). */
export function expensesScenarioCategories (): Map<string, ExpenseCategoryInfo> {
  return new Map(CATEGORIES.map((c) => [c.key, { name: c.name, behavior: c.behavior, dreGroup: c.dreGroup, subcategories: c.subcategories }]))
}

/** Documentos para plantar no Mongo (integração/E2E). */
export function expensesScenario (month: string, restaurantId: string) {
  const audit = () => ({ createdAt: new Date(), updatedAt: new Date() })
  const ids = new Map([...CATEGORIES.map((c) => c.key), DELETED.key].map((k) => [k, new ObjectId()]))
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
    subcategories: (c.subcategories ?? []).map((sub) => ({ ...sub, status: 'active' })),
    audit: audit(),
  }))
  const movements = LINES.map((l, i) => {
    const acc = ACCOUNTS[l.acc ?? 'cash']
    const fee = l.fee ?? 0
    const type = defOf(l.key)?.type ?? 'expense'
    return {
      restaurantId,
      title: `${nameOf(l.key)} ${i}`,
      direction: directionOf(l.key),
      status: l.cancelled ? 'cancelled' : 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(addMonths(month, l.month)).getTime() + (2 + (i % 20)) * 86_400_000 + 12 * 3_600_000),
      grossValue: toDecimal128(l.gross),
      feeValue: toDecimal128(fee),
      netValue: toDecimal128(l.gross - fee),
      account: acc,
      category: { _id: String(ids.get(l.key)), name: nameOf(l.key), type },
      ...(l.channel ? { channel: l.channel } : {}),
      ...(l.sub ? { subcategory: { _id: l.sub, name: subName(l.sub) } } : {}),
      paymentMethod: 'pix',
      origin: 'manual',
      description: EXPENSES_SEED_MARKER,
      history: [],
      audit: audit(),
    }
  })
  return { categories, movements }
}
