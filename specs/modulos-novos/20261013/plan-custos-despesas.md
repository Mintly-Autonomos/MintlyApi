# Fatia 6 — Custos & Despesas (fatia A) — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo: teste que falha → ver
> falhar → mínimo → ver passar → commit.

**Goal:** `GET /reports/expenses?month=&channel=` com total, CMV, prime cost, taxa de plataforma
por conta e a lista de categorias com comparação contra o mês anterior e a média de 3 meses.

**Architecture:** contrato na lib (tipos + `ReportClient.expenses`); na API, um módulo
`reports/expenses` com repositório (agrupamento por mês × direção × categoria × canal gravado ×
conta), regra pura `computeExpenses` (canal efetivo pela `effectiveChannel` da fatia 5) e a rota.

**Tech Stack:** TypeScript, Fastify 5, MongoDB, Jest (lib), Vitest (API).

**Spec:** `specs/modulos-novos/20261013/custos-despesas.md` (aprovada em 13/10/2026).

## Global Constraints

- Nomes em inglês; commits em PT com rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura ≥ 90% (`npm run test:ci`).
- Lib: `feat` **sem** `!` (aditivo).
- Somas em centavos (`toCents`/`fromCents`); percentuais e variações como fração, sem arredondar.
- Mês por competência no fuso `America/Sao_Paulo`; canceladas fora.
- Metas: CMV 28–35%, prime cost ≤ 65% (MIN-84).
- Média de 3 meses: M−1..M−3 a partir do mês do primeiro lançamento; nenhum elegível → `null`; média em centavos com `Math.round`.
- Variação com base 0 → `null`; % da receita com receita 0 → `null`.
- Branches `feat/20261013/custos-despesas` nos dois repositórios (a da API já existe).

## Review Focus

1. **Restaurante novo / mês sem nada** — tudo zero, médias `null`, variações `null`, nenhum `NaN`/`Infinity`, 200. → Tarefa 2 e 3.
2. **Entrada de plataforma que o dono marcou como `dineIn`** — a taxa dela vai para o salão, não para o delivery. → Tarefa 2.
3. **Conta de plataforma renomeada ou apagada** — linha usa o nome atual; sem a conta, o nome gravado no lançamento. → Tarefa 2.
4. **Despesa com receita zero no mês** — `pctOfRevenue: null`, CMV % `null`. → Tarefa 2.
5. **`channel=shared` ou valor qualquer** — 400, não um relatório vazio. → Tarefa 2 e 3.

---

## Cenário de conferência (relativo a M; usado nos testes unitários e de integração)

Contas: `Caixa` (cash), `iFood` (platform), `Rappi` (platform). Primeiro lançamento em M−3.

| Mês | Lançamentos |
|---|---|
| M | entradas: Caixa 30.000 · iFood 10.000 (taxa 2.300) · Rappi 4.000 (taxa 600) · Caixa 1.000 marcada `delivery`. saídas: CMV 12.000 · CMV 2.000 `delivery` · Pró-labore 6.000 · Aluguel 4.000 · Utilidades 1.500 · Marketing 800 `delivery` · Impostos 2.200 · Motoboy 900 `delivery` · CMV 500 **cancelada** |
| M−1 | entradas: Caixa 25.000 · iFood 8.000 (taxa 1.840). saídas: CMV 10.000 · Pró-labore 6.000 · Aluguel 4.000 · Utilidades 1.200 · Marketing 1.000 · **Antiga** (categoria apagada) 300 · Impostos 1.800 |
| M−2 | entradas: Caixa 24.000. saídas: CMV 9.500 · Pró-labore 6.000 · Aluguel 4.000 · Utilidades 1.300 · Impostos 1.700 |
| M−3 | entradas: Caixa 22.000 · iFood 5.000 (taxa 1.150). saídas: CMV 9.000 · Pró-labore 6.000 · Aluguel 4.000 · Utilidades 1.100 · Marketing 500 · Impostos 1.600 |

**Geral (M):** receita 45.000 (anterior 33.000) · total 32.300 · anterior 26.140 · média 23.996,67
((26.140 + 22.500 + 23.350) / 3) · CMV 14.000 (31,11%) · prime cost 20.000 (44,44%) · taxa 2.900,
anterior 1.840, receita delivery 15.000 (19,33%) · fixo 12.200 · variável 18.600 · misto 1.500 ·
histórico [0, 0, 23.350, 22.500, 26.140, 32.300].

Itens (ordem): CMV 14.000 (ant. 10.000, média 9.500) · Pró-labore 6.000 (6.000 / 6.000) · Aluguel
4.000 (4.000 / 4.000) · Taxa iFood 2.300 (1.840 / 996,67) · Impostos 2.200 (1.800 / 1.700) ·
Utilidades 1.500 (1.200 / 1.200) · Motoboy 900 (0 / 0) · Marketing 800 (1.000 / 500) · Taxa Rappi
600 (0 / 0) · Antiga 0 (300 / 100).

**Delivery (M):** receita 15.000 · itens: Taxa iFood 2.300 · CMV 2.000 · Motoboy 900 · Marketing 800 ·
Taxa Rappi 600 → total 6.600 · anterior 1.840 · `sharedExcluded` 25.700 (12.000 + 6.000 + 4.000 +
1.500 + 2.200) · CMV 13,33% · prime cost 2.000 · fixo 0 · variável 6.600.

**Salão (M):** receita 30.000 · itens [] · total 0 · `sharedExcluded` 25.700 · taxa 0 · receita
delivery 0 · `pctOfDelivery` null.

---

## Tarefa 1 — MintlyLib: contrato e client

**Branch:** `git checkout staging && git pull && git checkout -b feat/20261013/custos-despesas`

**Files:** Create `src/core/data/reports/expenses-response.ts`; Modify `src/core/data/reports/index.ts`, `src/clients/report-client.ts`; Tests: `src/clients/report-client.spec.ts`, `src/core/data/reports/index.spec.ts` (novo).

**Interfaces — Produces:** `ExpensesQuery`, `ExpensesReport`, `ExpenseItem`, `ExpenseItemKind`, `ExpensesTotal`, `ExpensesPlatformFee`; `ReportClient.expenses(query, headers)`.

- [ ] **Passo 1: Testes que falham** — em `report-client.spec.ts`:

```ts
  it('expenses faz GET /expenses com mês e canal na query', async () => {
    const client = new ReportClient()
    const get = jest.spyOn((client as any).http.connection, 'get').mockResolvedValue({ data: { payload: { referenceMonth: '2026-08' } } } as any)

    const res = await client.expenses({ month: '2026-08', channel: MovementChannel.Delivery }, { env: 'staging', authorization: 'Bearer t' } as any)

    expect(get).toHaveBeenCalledWith('/expenses', expect.objectContaining({ params: { month: '2026-08', channel: 'delivery' } }))
    expect(res.payload).toEqual({ referenceMonth: '2026-08' })
  })
```

(importe `MovementChannel` de `'../core/data/financial/financial-movement-schema'`).

`src/core/data/reports/index.spec.ts`:

```ts
import type * as reports from './index'

// Contrato só de tipos: o teste é o typecheck desta atribuição.
describe('barrel de reports', () => {
  it('exporta os tipos de Custos & Despesas', () => {
    const item: reports.ExpenseItem = { key: 'c1', kind: 'category', categoryId: 'c1', name: 'CMV', behavior: 'variable' as any, dreGroup: 'cmv' as any, amount: 1, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null, pctOfRevenue: null }
    const query: reports.ExpensesQuery = { month: '2026-08' }
    expect(item.kind).toBe('category')
    expect(query.month).toBe('2026-08')
  })
})
```

- [ ] **Passo 2: Ver falhar** — `npx jest src/clients/report-client.spec.ts src/core/data/reports` → FAIL (`expenses` e os tipos não existem).

- [ ] **Passo 3: Tipos** — `expenses-response.ts`:

```ts
import type { CategoryBehavior, DreGroup } from '../financial/financial-category-schema'
import type { MovementChannel } from '../financial/financial-movement-schema'

/**
 * Contrato de GET /reports/expenses (fatia 6). Por competência; número cru;
 * percentuais e variações como fração (0.311 = 31,1%). Spec:
 * MintlyApi/specs/modulos-novos/20261013/custos-despesas.md.
 */

/** `month` em AAAA-MM (padrão: mês corrente). Sem `channel` = Geral. */
export interface ExpensesQuery {
  month?: string
  channel?: MovementChannel.DineIn | MovementChannel.Delivery
}

export type ExpenseItemKind = 'category' | 'platformFee'

/** Linha de "Para onde está indo seu dinheiro": categoria ou taxa de uma conta de plataforma. */
export interface ExpenseItem {
  /** categoryId, ou `platformFee:<accountId>`. */
  key: string
  kind: ExpenseItemKind
  categoryId: string | null
  name: string
  behavior: CategoryBehavior
  dreGroup: DreGroup | null
  amount: number
  previous: number
  /** Média de M−1..M−3 (desde o primeiro lançamento); `null` sem mês elegível. */
  average3: number | null
  deltaPrevious: number | null
  deltaAverage3: number | null
  pctOfRevenue: number | null
}

export interface ExpensesTotal {
  current: number
  previous: number
  average3: number | null
  deltaPrevious: number | null
  deltaAverage3: number | null
}

export interface ExpensesPlatformFee {
  amount: number
  previous: number
  deltaPrevious: number | null
  /** Σ receita bruta de canal efetivo delivery no mês. */
  deliveryRevenue: number
  pctOfDelivery: number | null
}

export interface ExpensesReport {
  referenceMonth: string
  previousMonth: string
  channel: MovementChannel | null
  revenue: { current: number; previous: number }
  total: ExpensesTotal
  cmv: { amount: number; pctOfRevenue: number | null; target: { min: number; max: number } }
  primeCost: { amount: number; cmv: number; labor: number; pctOfRevenue: number | null; targetMax: number }
  platformFee: ExpensesPlatformFee
  /** Misto separado (a tela mostra "Misto"). */
  byBehavior: { fixed: number; variable: number; mixed: number }
  items: ExpenseItem[]
  /** Só com `channel`: Σ saídas de canal efetivo `shared` que ficaram de fora. */
  sharedExcluded: number | null
  /** 6 meses, do mais antigo ao mês de referência. */
  history: { month: string; total: number }[]
}
```

`reports/index.ts`: `export * from './expenses-response'`.

- [ ] **Passo 4: Client** — em `report-client.ts` (importe `ExpensesQuery`, `ExpensesReport`):

```ts
  /** Custos & Despesas do mês (fatia A): total, CMV, prime cost, taxa de plataforma e categorias. */
  async expenses (query: ExpensesQuery, headers: Headers): Promise<ResponseDto<ExpensesReport>> {
    const response = await this.http.connection.get<ResponseDto<ExpensesReport>>('/expenses', withHeaders(headers, { params: query }))
    return response.data
  }
```

e ajuste o comentário da classe ("As próximas fatias (result, expenses)…") para "A Visão Geral entra aqui como método".

- [ ] **Passo 5: Ver passar + checagens** — `npx jest && npm run typecheck && npm run lint && npm run build` → verde.

- [ ] **Passo 6: Commit e push** — `git add src && git commit -m "feat(reports): contrato e client de custos e despesas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin feat/20261013/custos-despesas`

---

## Tarefa 2 — MintlyApi: regra pura e cenário

**Files:** Create `src/app/reports/expenses/expenses-metrics.ts` (+ `.spec.ts`), `src/app/reports/expenses/expenses-scenario.ts`.

**Interfaces — Consumes:** tipos da T1; `effectiveChannel` (`reports/shared/channel.ts`).
**Produces:**

```ts
export const HISTORY_MONTHS = 6
export const CMV_TARGET = { min: 0.28, max: 0.35 }
export const PRIME_COST_TARGET_MAX = 0.65
export interface ExpenseRow { month: string; direction: 'in' | 'out'; categoryId: string; categoryName: string; accountId: string; accountName: string; accountType: string; channel: string | null; gross: number; fee: number }
export interface ExpenseCategoryInfo { name: string; behavior: CategoryBehavior; dreGroup?: DreGroup }
export interface ExpensesInput { referenceMonth: string; channel: MovementChannel | null; rows: ExpenseRow[]; categories: Map<string, ExpenseCategoryInfo>; accountNames: Map<string, string>; firstMonth: string | null }
export function parseExpensesChannel (value: unknown): MovementChannel | null
export function computeExpenses (input: ExpensesInput): ExpensesReport
// expenses-scenario.ts
export function expensesScenarioRows (month: string): ExpenseRow[]
export function expensesScenarioCategories (): Map<string, ExpenseCategoryInfo>
export function expensesScenario (month: string, restaurantId: string): { categories: any[]; movements: any[] }
```

- [ ] **Passo 1: Build local da lib** — `cd ../MintlyLib && npm run build && cd ../MintlyApi && rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build` (não commitar).

- [ ] **Passo 2: Cenário** (dado de teste, sem lógica a testar) — `expenses-scenario.ts`:

```ts
import { ObjectId } from 'mongodb'
import { CategoryBehavior, DreGroup } from 'mintly-lib'
import { toDecimal128 } from '../../../core/money/money'
import { addMonths, startOfLocalMonth } from '../shared/period'
import { ExpenseCategoryInfo, ExpenseRow } from './expenses-metrics'

/**
 * Cenário de Custos & Despesas relativo ao mês M — os números esperados estão no
 * plano (specs/modulos-novos/20261013/plan-custos-despesas.md, "Cenário").
 * Primeiro lançamento em M−3; "Antiga" é categoria apagada (só no lançamento).
 */
export const EXPENSES_SEED_MARKER = 'seed-demo:expenses'

interface Def { key: string; name: string; type: 'revenue' | 'expense'; dreGroup?: DreGroup; behavior: CategoryBehavior }
const CATEGORIES: Def[] = [
  { key: 'ven', name: 'Exp · Vendas', type: 'revenue', behavior: CategoryBehavior.Variable },
  { key: 'cmv', name: 'Exp · CMV', type: 'expense', dreGroup: DreGroup.Cmv, behavior: CategoryBehavior.Variable },
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

interface Line { month: 0 | -1 | -2 | -3; key: string; gross: number; fee?: number; acc?: Acc; channel?: 'delivery'; cancelled?: boolean }
const LINES: Line[] = [
  { month: 0, key: 'ven', gross: 30_000 },
  { month: 0, key: 'ven', gross: 10_000, fee: 2_300, acc: 'ifood' },
  { month: 0, key: 'ven', gross: 4_000, fee: 600, acc: 'rappi' },
  { month: 0, key: 'ven', gross: 1_000, channel: 'delivery' },
  { month: 0, key: 'cmv', gross: 12_000 },
  { month: 0, key: 'cmv', gross: 2_000, channel: 'delivery' },
  { month: 0, key: 'pro', gross: 6_000 },
  { month: 0, key: 'alu', gross: 4_000 },
  { month: 0, key: 'uti', gross: 1_500 },
  { month: 0, key: 'mkt', gross: 800, channel: 'delivery' },
  { month: 0, key: 'imp', gross: 2_200 },
  { month: 0, key: 'mot', gross: 900, channel: 'delivery' },
  { month: 0, key: 'cmv', gross: 500, cancelled: true },
  { month: -1, key: 'ven', gross: 25_000 },
  { month: -1, key: 'ven', gross: 8_000, fee: 1_840, acc: 'ifood' },
  { month: -1, key: 'cmv', gross: 10_000 },
  { month: -1, key: 'pro', gross: 6_000 },
  { month: -1, key: 'alu', gross: 4_000 },
  { month: -1, key: 'uti', gross: 1_200 },
  { month: -1, key: 'mkt', gross: 1_000 },
  { month: -1, key: 'old', gross: 300 },
  { month: -1, key: 'imp', gross: 1_800 },
  { month: -2, key: 'ven', gross: 24_000 },
  { month: -2, key: 'cmv', gross: 9_500 },
  { month: -2, key: 'pro', gross: 6_000 },
  { month: -2, key: 'alu', gross: 4_000 },
  { month: -2, key: 'uti', gross: 1_300 },
  { month: -2, key: 'imp', gross: 1_700 },
  { month: -3, key: 'ven', gross: 22_000 },
  { month: -3, key: 'ven', gross: 5_000, fee: 1_150, acc: 'ifood' },
  { month: -3, key: 'cmv', gross: 9_000 },
  { month: -3, key: 'pro', gross: 6_000 },
  { month: -3, key: 'alu', gross: 4_000 },
  { month: -3, key: 'uti', gross: 1_100 },
  { month: -3, key: 'mkt', gross: 500 },
  { month: -3, key: 'imp', gross: 1_600 },
]

const defOf = (key: string) => CATEGORIES.find((c) => c.key === key)
const nameOf = (key: string) => defOf(key)?.name ?? DELETED.name
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
      gross: l.gross,
      fee: l.fee ?? 0,
    }
  })
}

/** Categorias vivas do cenário por chave ("Antiga" não está — foi apagada). */
export function expensesScenarioCategories (): Map<string, ExpenseCategoryInfo> {
  return new Map(CATEGORIES.map((c) => [c.key, { name: c.name, behavior: c.behavior, dreGroup: c.dreGroup }]))
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
    subcategories: [],
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
      paymentMethod: 'pix',
      origin: 'manual',
      description: EXPENSES_SEED_MARKER,
      history: [],
      audit: audit(),
    }
  })
  return { categories, movements }
}
```

- [ ] **Passo 3: Testes que falham** — `expenses-metrics.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CategoryBehavior, DreGroup, MovementChannel } from 'mintly-lib'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { addMonths } from '../shared/period'
import { ExpenseRow, computeExpenses, parseExpensesChannel } from './expenses-metrics'
import { expensesScenarioCategories, expensesScenarioRows } from './expenses-scenario'

const M = '2026-08'
const scenario = (channel: MovementChannel | null = null, overrides: Partial<Parameters<typeof computeExpenses>[0]> = {}) => computeExpenses({
  referenceMonth: M, channel, rows: expensesScenarioRows(M), categories: expensesScenarioCategories(), accountNames: new Map(), firstMonth: addMonths(M, -3), ...overrides,
})
const byName = (r: ReturnType<typeof computeExpenses>, name: string) => r.items.find((i) => i.name === name)!

describe('parseExpensesChannel', () => {
  it('ausente ou vazio → Geral', () => {
    expect(parseExpensesChannel(undefined)).toBeNull()
    expect(parseExpensesChannel('')).toBeNull()
  })
  it('dineIn e delivery aceitos', () => {
    expect(parseExpensesChannel('dineIn')).toBe(MovementChannel.DineIn)
    expect(parseExpensesChannel('delivery')).toBe(MovementChannel.Delivery)
  })
  it.each(['shared', 'salao', 42])('%j → 400', (v) => expect(() => parseExpensesChannel(v)).toThrow(ValidationError))
})

describe('computeExpenses — cenário Geral', () => {
  const r = scenario()

  it('cabeçalho, receita e total', () => {
    expect(r).toMatchObject({ referenceMonth: M, previousMonth: '2026-07', channel: null, sharedExcluded: null, revenue: { current: 45_000, previous: 33_000 } })
    expect(r.total).toMatchObject({ current: 32_300, previous: 26_140, average3: 23_996.67 })
    expect(r.total.deltaPrevious).toBeCloseTo(6_160 / 26_140, 10)
    expect(r.total.deltaAverage3).toBeCloseTo((32_300 - 23_996.67) / 23_996.67, 10)
  })

  it('CMV, prime cost e metas', () => {
    expect(r.cmv.amount).toBe(14_000)
    expect(r.cmv.pctOfRevenue).toBeCloseTo(14_000 / 45_000, 10)
    expect(r.cmv.target).toEqual({ min: 0.28, max: 0.35 })
    expect(r.primeCost).toMatchObject({ amount: 20_000, cmv: 14_000, labor: 6_000, targetMax: 0.65 })
    expect(r.primeCost.pctOfRevenue).toBeCloseTo(20_000 / 45_000, 10)
  })

  it('taxa de plataforma', () => {
    expect(r.platformFee).toMatchObject({ amount: 2_900, previous: 1_840, deliveryRevenue: 15_000 })
    expect(r.platformFee.deltaPrevious).toBeCloseTo(1_060 / 1_840, 10)
    expect(r.platformFee.pctOfDelivery).toBeCloseTo(2_900 / 15_000, 10)
  })

  it('quebra por comportamento com misto separado; histórico de 6 meses', () => {
    expect(r.byBehavior).toEqual({ fixed: 12_200, variable: 18_600, mixed: 1_500 })
    expect(r.history).toEqual([
      { month: '2026-03', total: 0 }, { month: '2026-04', total: 0 }, { month: '2026-05', total: 23_350 },
      { month: '2026-06', total: 22_500 }, { month: '2026-07', total: 26_140 }, { month: M, total: 32_300 },
    ])
  })

  it('itens na ordem, com anterior e média', () => {
    expect(r.items.map((i) => [i.name, i.amount, i.previous, i.average3])).toEqual([
      ['Exp · CMV', 14_000, 10_000, 9_500],
      ['Exp · Pró-labore', 6_000, 6_000, 6_000],
      ['Exp · Aluguel', 4_000, 4_000, 4_000],
      ['Taxa iFood', 2_300, 1_840, 996.67],
      ['Exp · Impostos', 2_200, 1_800, 1_700],
      ['Exp · Utilidades', 1_500, 1_200, 1_200],
      ['Exp · Motoboy', 900, 0, 0],
      ['Exp · Marketing', 800, 1_000, 500],
      ['Taxa Rappi', 600, 0, 0],
      ['Exp · Antiga', 0, 300, 100],
    ])
  })

  it('variações e % da receita por item', () => {
    expect(byName(r, 'Exp · CMV').deltaPrevious).toBeCloseTo(0.4, 10)
    expect(byName(r, 'Exp · CMV').deltaAverage3).toBeCloseTo(4_500 / 9_500, 10)
    expect(byName(r, 'Exp · CMV').pctOfRevenue).toBeCloseTo(14_000 / 45_000, 10)
    expect(byName(r, 'Exp · Marketing')).toMatchObject({ deltaPrevious: -0.2, deltaAverage3: 0.6 })
    expect(byName(r, 'Exp · Motoboy')).toMatchObject({ deltaPrevious: null, deltaAverage3: null })
    expect(byName(r, 'Exp · Antiga')).toMatchObject({ deltaPrevious: -1, deltaAverage3: -1, pctOfRevenue: 0 })
  })

  it('metadados: taxa por conta, imposto no total, categoria apagada', () => {
    expect(byName(r, 'Taxa iFood')).toMatchObject({ key: 'platformFee:exp-ifood', kind: 'platformFee', categoryId: null, behavior: CategoryBehavior.Variable, dreGroup: null })
    expect(byName(r, 'Exp · Impostos')).toMatchObject({ kind: 'category', categoryId: 'imp', dreGroup: DreGroup.Tax, behavior: CategoryBehavior.Fixed })
    expect(byName(r, 'Exp · Antiga')).toMatchObject({ categoryId: 'old', behavior: CategoryBehavior.Fixed, dreGroup: DreGroup.Opex })
  })
})

describe('computeExpenses — filtro de canal', () => {
  it('Delivery: só o canal efetivo delivery; shared fica de fora e é informado', () => {
    const r = scenario(MovementChannel.Delivery)
    expect(r).toMatchObject({ channel: 'delivery', sharedExcluded: 25_700, revenue: { current: 15_000, previous: 8_000 } })
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([['Taxa iFood', 2_300], ['Exp · CMV', 2_000], ['Exp · Motoboy', 900], ['Exp · Marketing', 800], ['Taxa Rappi', 600]])
    expect(r.total).toMatchObject({ current: 6_600, previous: 1_840 })
    expect(r.cmv.pctOfRevenue).toBeCloseTo(2_000 / 15_000, 10)
    expect(r.primeCost).toMatchObject({ amount: 2_000, labor: 0 })
    expect(r.byBehavior).toEqual({ fixed: 0, variable: 6_600, mixed: 0 })
  })

  it('Salão: sem despesas próprias; taxa e receita delivery zeradas', () => {
    const r = scenario(MovementChannel.DineIn)
    expect(r).toMatchObject({ channel: 'dineIn', sharedExcluded: 25_700, items: [], revenue: { current: 30_000 } })
    expect(r.total.current).toBe(0)
    expect(r.platformFee).toMatchObject({ amount: 0, deliveryRevenue: 0, pctOfDelivery: null })
  })

  it('entrada de plataforma marcada dineIn leva a taxa para o salão', () => {
    const rows: ExpenseRow[] = [{ month: M, direction: 'in', categoryId: 'ven', categoryName: 'Vendas', accountId: 'p1', accountName: 'iFood', accountType: 'platform', channel: 'dineIn', gross: 1_000, fee: 120 }]
    const dineIn = scenario(MovementChannel.DineIn, { rows })
    const delivery = scenario(MovementChannel.Delivery, { rows })
    expect(dineIn.platformFee.amount).toBe(120)
    expect(dineIn.platformFee.deliveryRevenue).toBe(0)
    expect(delivery.platformFee.amount).toBe(0)
  })
})

describe('computeExpenses — bordas', () => {
  it('restaurante novo, sem nada: zeros, médias e variações null', () => {
    const r = scenario(null, { rows: [], firstMonth: null })
    expect(r.items).toEqual([])
    expect(r.total).toEqual({ current: 0, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null })
    expect(r.cmv.pctOfRevenue).toBeNull()
    expect(r.primeCost.pctOfRevenue).toBeNull()
    expect(r.platformFee.pctOfDelivery).toBeNull()
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })

  it('primeiro lançamento em M−1: média só desse mês', () => {
    const r = scenario(null, { firstMonth: addMonths(M, -1) })
    expect(r.total.average3).toBe(26_140)
    expect(byName(r, 'Exp · CMV').average3).toBe(10_000)
  })

  it('primeiro lançamento em M: média null', () => {
    const r = scenario(null, { firstMonth: M })
    expect(r.total.average3).toBeNull()
    expect(byName(r, 'Exp · CMV')).toMatchObject({ average3: null, deltaAverage3: null })
  })

  it('despesa sem receita no mês: % da receita null', () => {
    const rows: ExpenseRow[] = [{ month: M, direction: 'out', categoryId: 'cmv', categoryName: 'CMV', accountId: 'c', accountName: 'Caixa', accountType: 'cash', channel: null, gross: 500, fee: 0 }]
    const r = scenario(null, { rows })
    expect(r.cmv).toMatchObject({ amount: 500, pctOfRevenue: null })
    expect(r.items[0].pctOfRevenue).toBeNull()
  })

  it('conta de plataforma renomeada: nome atual; apagada: nome gravado', () => {
    const r = scenario(null, { accountNames: new Map([['exp-ifood', 'iFood Loja 2']]) })
    expect(r.items.map((i) => i.name)).toContain('Taxa iFood Loja 2')
    expect(r.items.map((i) => i.name)).toContain('Taxa Rappi')
  })

  it('categoria reclassificada vale para o passado (classificação atual)', () => {
    const categories = expensesScenarioCategories()
    categories.set('mkt', { ...categories.get('mkt')!, behavior: CategoryBehavior.Fixed })
    const r = scenario(null, { categories })
    expect(r.byBehavior).toEqual({ fixed: 13_000, variable: 17_800, mixed: 1_500 })
    expect(byName(r, 'Exp · Marketing').behavior).toBe(CategoryBehavior.Fixed)
  })

  it('categoria sem dreGroup conta como opex (fora do CMV)', () => {
    const categories = expensesScenarioCategories()
    categories.set('cmv', { name: 'Exp · CMV', behavior: CategoryBehavior.Variable })
    const r = scenario(null, { categories })
    expect(r.cmv.amount).toBe(0)
    expect(byName(r, 'Exp · CMV').dreGroup).toBe(DreGroup.Opex)
  })
})
```

- [ ] **Passo 4: Ver falhar** — `npx vitest run src/app/reports/expenses/expenses-metrics.spec.ts` → FAIL (`expenses-metrics` não existe).

- [ ] **Passo 5: Implementar** — `expenses-metrics.ts`:

```ts
import { CategoryBehavior, DreGroup, ExpenseItem, ExpenseItemKind, ExpensesReport, MovementChannel } from 'mintly-lib'
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
  shared: number
  items: Map<string, number>
}

const emptyBucket = (): MonthBucket => ({ revenue: 0, deliveryRevenue: 0, shared: 0, items: new Map() })

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
    platformFee: { amount: fromCents(fee), previous: fromCents(feePrev), deltaPrevious: delta(fee, feePrev), deliveryRevenue: fromCents(cur.deliveryRevenue), pctOfDelivery: share(fee, cur.deliveryRevenue) },
    byBehavior: { fixed: behavior(CategoryBehavior.Fixed), variable: behavior(CategoryBehavior.Variable), mixed: behavior(CategoryBehavior.Mixed) },
    items,
    sharedExcluded: input.channel == null ? null : fromCents(cur.shared),
    history: Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(M, i - (HISTORY_MONTHS - 1))).map((m) => ({ month: m, total: fromCents(total(at(m))) })),
  }
}
```

(Ruling antecipado: `deltaAverage3` é calculado em centavos sobre a média já arredondada — o teste usa a média arredondada, 23.996,67.)

- [ ] **Passo 6: Ver passar** — mesmo comando → PASS. `npx tsc --noEmit` e `npx eslint src/app/reports/expenses` → limpos.

- [ ] **Passo 7: Commit** — `git add src/app/reports/expenses && git commit -m "feat(reports): regras de custos e despesas e cenario de conferencia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 3 — Repositório, consulta e rota

**Files:** Create `src/app/reports/expenses/expenses-repository.ts`, `use-cases/expenses.query.ts`, `expenses-controller.ts`, `expenses-routes.ts`, `expenses.int.spec.ts`; Modify `src/infrastructure/server/build-server.ts`.

**Interfaces — Consumes:** `computeExpenses`, `parseExpensesChannel`, `HISTORY_MONTHS`, `ExpenseRow`, `ExpenseCategoryInfo`, `expensesScenario` (T2); `TaxRepository.firstMovementMonth`; `parseReferenceMonth`.

- [ ] **Passo 1: Testes de integração que falham** — `expenses.int.spec.ts` (mesmo `beforeAll`/`afterAll`/`signup` do `result.int.spec.ts`; `freshEnv` com prefixo `int_expenses_`; `M = addMonths(toLocalMonth(new Date()), -1)`):

```ts
  async function plant (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const { categories, movements } = expensesScenario(M, restaurantId)
    await db.collection('financial_categories').insertMany(categories)
    await db.collection('financial_movements').insertMany(movements)
  }

  const get = (auth: Record<string, string>, query = `?month=${M}`) => app.inject({ method: 'GET', url: `/reports/expenses${query}`, headers: auth })

  it('confere o cenário (Geral)', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const res = await get(auth)

    expect(res.statusCode).toBe(200)
    const r = res.json().payload
    expect(r).toMatchObject({ referenceMonth: M, channel: null, revenue: { current: 45_000, previous: 33_000 }, total: { current: 32_300, previous: 26_140, average3: 23_996.67 } })
    expect(r).toMatchObject({ cmv: { amount: 14_000 }, primeCost: { amount: 20_000 }, platformFee: { amount: 2_900, previous: 1_840, deliveryRevenue: 15_000 }, byBehavior: { fixed: 12_200, variable: 18_600, mixed: 1_500 } })
    expect(r.items.map((i: any) => [i.name, i.amount])).toEqual([
      ['Exp · CMV', 14_000], ['Exp · Pró-labore', 6_000], ['Exp · Aluguel', 4_000], ['Taxa iFood', 2_300], ['Exp · Impostos', 2_200],
      ['Exp · Utilidades', 1_500], ['Exp · Motoboy', 900], ['Exp · Marketing', 800], ['Taxa Rappi', 600], ['Exp · Antiga', 0],
    ])
    expect(r.history.map((h: any) => h.total)).toEqual([0, 0, 23_350, 22_500, 26_140, 32_300])
  })

  it('filtro Delivery e Salão', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const delivery = (await get(auth, `?month=${M}&channel=delivery`)).json().payload
    const dineIn = (await get(auth, `?month=${M}&channel=dineIn`)).json().payload

    expect(delivery).toMatchObject({ channel: 'delivery', sharedExcluded: 25_700, total: { current: 6_600 }, revenue: { current: 15_000 } })
    expect(dineIn).toMatchObject({ channel: 'dineIn', sharedExcluded: 25_700, items: [], total: { current: 0 } })
  })

  it('reclassificar a categoria muda o comportamento no mês passado', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    await mongoConnection.getDatabase(env).collection('financial_categories').updateOne({ restaurantId, name: 'Exp · Marketing' }, { $set: { behavior: 'fixed' } })

    const r = (await get(auth)).json().payload

    expect(r.byBehavior).toEqual({ fixed: 13_000, variable: 17_800, mixed: 1_500 })
  })

  it('despesa às 22h do último dia conta no próprio mês', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertOne({
      restaurantId, title: 'Noite', direction: 'out', status: 'settled', statusSource: 'auto',
      date: new Date(startOfLocalMonth(addMonths(M, 1)).getTime() - 2 * 3_600_000),
      grossValue: toDecimal128(250), feeValue: toDecimal128(0), netValue: toDecimal128(250),
      account: { _id: 'a', name: 'Caixa', type: 'cash' }, category: { _id: 'c', name: 'Gás', type: 'expense' },
      paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const r = (await get(auth)).json().payload

    expect(r.total.current).toBe(250)
    expect(r.items[0]).toMatchObject({ name: 'Gás', amount: 250, average3: null })
  })

  it('restaurante sem lançamentos: 200 com zeros', async () => {
    const { auth } = await signup(freshEnv())
    const r = (await get(auth)).json().payload
    expect(r).toMatchObject({ items: [], total: { current: 0, average3: null }, cmv: { pctOfRevenue: null } })
  })

  it('dois restaurantes no mesmo ambiente não se misturam', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(env, a.restaurantId)

    const rb = (await get(b.auth)).json().payload

    expect(rb.total.current).toBe(0)
    expect(rb.items).toEqual([])
  })

  it.each(['?month=2026-13', 'FUTURE', '?channel=shared', '?channel=salao'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    const query = q === 'FUTURE' ? `?month=${addMonths(M, 2)}` : q
    expect((await get(auth, query)).statusCode).toBe(400)
  })

  it('sem month: mês corrente; sem token → 401', async () => {
    const { auth } = await signup(freshEnv())
    expect((await get(auth, '')).json().payload.referenceMonth).toBe(toLocalMonth(new Date()))
    expect((await app.inject({ method: 'GET', url: '/reports/expenses', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })
```

(imports: `toDecimal128`, `addMonths`, `startOfLocalMonth`, `toLocalMonth`, `expensesScenario`.)

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/reports/expenses/expenses.int.spec.ts` → FAIL (404 na rota).

- [ ] **Passo 3: Repositório** — `expenses-repository.ts`:

```ts
import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth } from '../shared/period'
import { ExpenseCategoryInfo, ExpenseRow } from './expenses-metrics'

/**
 * Consultas de Custos & Despesas: por competência no fuso de SP, sem canceladas,
 * sempre com restaurantId do contexto. O canal efetivo é resolvido depois, em TS.
 */
export class ExpensesRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /** Σ grossValue e Σ feeValue por mês × direção × categoria × canal gravado × conta, em [from, to]. */
  async monthlyRows (ctx: RequestContext, w: { from: string; to: string }): Promise<ExpenseRow[]> {
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled }, date: { $gte: startOfLocalMonth(w.from), $lt: startOfLocalMonth(addMonths(w.to, 1)) } } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } },
            direction: '$direction',
            categoryId: '$category._id',
            channel: { $ifNull: ['$channel', null] },
            accountId: '$account._id',
            accountType: '$account.type',
          },
          gross: { $sum: '$grossValue' },
          fee: { $sum: '$feeValue' },
          categoryName: { $first: '$category.name' },
          accountName: { $first: '$account.name' },
        },
      },
    ]).toArray()

    return rows.map((r) => ({
      month: r._id.month,
      direction: r._id.direction === MovementDirection.In ? 'in' : 'out',
      categoryId: String(r._id.categoryId),
      categoryName: r.categoryName ?? '',
      accountId: String(r._id.accountId),
      accountName: r.accountName ?? '',
      accountType: r._id.accountType ?? '',
      channel: r._id.channel ?? null,
      gross: decimalToNumber(r.gross),
      fee: decimalToNumber(r.fee),
    }))
  }

  /** Todas as categorias do restaurante (inativa também pode ter lançamento antigo). */
  async categories (ctx: RequestContext): Promise<Map<string, ExpenseCategoryInfo>> {
    const docs = await this.db(ctx).collection('financial_categories')
      .find({ restaurantId: ctx.restaurantId }, { projection: { name: 1, dreGroup: 1, behavior: 1 } })
      .toArray()
    return new Map(docs.map((d) => [String(d._id), { name: d.name, behavior: d.behavior, dreGroup: d.dreGroup }]))
  }

  /** Nome atual das contas (a linha da taxa usa o nome vivo). */
  async accountNames (ctx: RequestContext): Promise<Map<string, string>> {
    const docs = await this.db(ctx).collection('financial_accounts')
      .find({ restaurantId: ctx.restaurantId }, { projection: { name: 1 } })
      .toArray()
    return new Map(docs.map((d) => [String(d._id), d.name]))
  }
}
```

- [ ] **Passo 4: Consulta, controller, rota** — `use-cases/expenses.query.ts`:

```ts
import { ExpensesReport } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addMonths, parseReferenceMonth } from '../../shared/period'
import { TaxRepository } from '../../../tax/tax-repository'
import { ExpensesRepository } from '../expenses-repository'
import { HISTORY_MONTHS, computeExpenses, parseExpensesChannel } from '../expenses-metrics'

/** Custos & Despesas: resolve mês e canal, lê a janela de 6 meses e entrega à regra pura. Read-only. */
export class ExpensesQuery {
  constructor (
    private readonly repo: ExpensesRepository = new ExpensesRepository(),
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, month?: string, channel?: unknown): Promise<ExpensesReport> {
    const referenceMonth = parseReferenceMonth(month, this.clock())
    const filter = parseExpensesChannel(channel)
    const [rows, categories, accountNames, firstMonth] = await Promise.all([
      this.repo.monthlyRows(ctx, { from: addMonths(referenceMonth, -(HISTORY_MONTHS - 1)), to: referenceMonth }),
      this.repo.categories(ctx),
      this.repo.accountNames(ctx),
      this.taxRepo.firstMovementMonth(ctx),
    ])
    return computeExpenses({ referenceMonth, channel: filter, rows, categories, accountNames, firstMonth })
  }
}
```

`expenses-controller.ts`:

```ts
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { ExpensesQuery } from './use-cases/expenses.query'

export class ExpensesController {
  constructor (private readonly query: ExpensesQuery = new ExpensesQuery()) {}

  /** GET /reports/expenses?month=AAAA-MM&channel=dineIn|delivery */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { month, channel } = request.query ?? {}
    const report = await this.query.execute(ctx, month, channel)
    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
```

`expenses-routes.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { ExpensesController } from './expenses-controller'

export async function expensesRoutes (fastify: FastifyInstance) {
  const controller = new ExpensesController()

  // GET /reports/expenses?month=AAAA-MM&channel=dineIn|delivery — fatia 6. Mês futuro/inválido ou canal inválido → 400.
  fastify.get('/expenses', async (request: any, reply) => controller.get(request, reply))
}
```

Em `build-server.ts`: importe `expensesRoutes` e registre `await protectedScope.register(expensesRoutes, { prefix: '/reports' })` logo depois de `resultRoutes`.

- [ ] **Passo 5: Ver passar** — `npx vitest run src/app/reports/expenses` → PASS.

- [ ] **Passo 6: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 7: Commit** — `git add src/app/reports/expenses src/infrastructure/server/build-server.ts && git commit -m "feat(reports): GET /reports/expenses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 4 — E2E e Insomnia

- [ ] **Passo 1: E2E** — `tests/e2e/expenses.e2e.spec.ts` no padrão de `result.e2e.spec.ts` (signup no env `e2e`, `cashId`, `revenueCatId`, `cmvCatId`; cria uma conta de plataforma por HTTP; `dropDatabase` no fim):

```ts
  it('CMV e venda em plataforma com taxa aparecem em Custos por HTTP real', async () => {
    const platform = await fetch(`${baseUrl}/financial-accounts/`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'iFood E2E', type: 'platform', feePercent: 20, settlementDays: 30, status: 'active' }) })
    expect(platform.status).toBe(201)
    const platformId = (await platform.json() as any).payload._id

    const post = (body: Record<string, unknown>) => fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ date: new Date().toISOString(), paymentMethod: 'pix', ...body }) })
    expect((await post({ direction: 'in', title: 'Delivery E2E', grossValue: 1000, accountId: platformId, categoryId: revenueCatId })).status).toBe(201)
    expect((await post({ direction: 'out', title: 'Insumos E2E', grossValue: 300, accountId: cashId, categoryId: cmvCatId })).status).toBe(201)

    const res = await fetch(`${baseUrl}/reports/expenses`, { headers: auth })
    expect(res.status).toBe(200)
    const r = (await res.json() as any).payload
    expect(r).toMatchObject({ total: { current: 500 }, cmv: { amount: 300 }, platformFee: { amount: 200, deliveryRevenue: 1000 } })
    expect(r.items.map((i: any) => i.name)).toEqual(['CMV/Insumos', 'Taxa iFood E2E'])
  })
```

(se o corpo de criação de conta de plataforma exigir outros campos, ajuste pelo `financialAccountInsertSchema` da lib e registre o ruling.) `npm run test:e2e` → verde.

- [ ] **Passo 2: Insomnia** — em `fld_reports`, requisição `req_expenses` "Custos & Despesas", `GET {{ _.base_url }}/reports/expenses`, headers `env` e `Authorization` como as outras, descrição "Fatia 6. ?month=AAAA-MM (padrão: mês corrente) e ?channel=dineIn|delivery (sem = Geral)."; diff só acrescenta.

- [ ] **Passo 3: Commit** — `git add tests/e2e/expenses.e2e.spec.ts insomnia/MintlyApi.insomnia_v4.json && git commit -m "test(reports): E2E de custos e despesas e insomnia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 5 — Fechar a fatia

- [ ] PR da lib (`feat(reports): custos e despesas, fatia A`) → merge → `npm i mintly-lib@<versão>` na API → suíte → commit `chore(deps)`.
- [ ] `andamento.md` (fatia 6 em review; pendências da revisão; Jira) → commit `docs(modulos-novos): andamento da fatia 6`.
- [ ] PR da API (`feat(reports): custos e despesas, fatia A`) com contrato, regras, "nenhum comando novo"; `gh pr checks` verde.

---

## Self-review

- **Cobertura da spec:** contrato e client → T1; todas as linhas da tabela de regras (janela, despesa, categoria atual/apagada, taxa por conta com nome vivo, canal efetivo, `sharedExcluded`, receita e receita delivery, média com primeiro lançamento, variação, % da receita, itens listados, totais, CMV/prime cost, misto separado, metas) → T2; repositório, 400/401, competência às 22h, multi-tenant, reclassificação → T3; E2E e Insomnia → T4.
- **Placeholders:** nenhum.
- **Tipos:** `ExpenseRow`/`ExpenseCategoryInfo`/`computeExpenses`/`parseExpensesChannel`/`HISTORY_MONTHS` (T2) usados com a mesma assinatura em T3; `ExpensesReport`/`ExpenseItem`/`ExpenseItemKind` (T1) em T2.
- **Review Focus:** os cinco têm teste — restaurante novo (T2 e T3), entrada de plataforma `dineIn` (T2), conta renomeada/apagada (T2), receita zero (T2), canal inválido (T2 e T3).
