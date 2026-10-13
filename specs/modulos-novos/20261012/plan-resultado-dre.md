# Fatia 4 — Resultado (DRE) — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo é uma ação de 2 a 5
> minutos: teste que falha → ver falhar → mínimo → ver passar → commit.

**Goal:** entregar `GET /reports/result?month=AAAA-MM` — DRE do mês e do anterior, variações,
composição das despesas operacionais, ponto de equilíbrio, histórico de 6 meses e insights.

**Architecture:** o repositório agrega por mês × direção × categoria (Mongo, fuso de SP) e lê as
categorias atuais; o imposto de cada mês sai do `buildTaxProfile` da fatia 3; uma regra pura
(`result-metrics.ts`) monta tudo em centavos.

**Tech Stack:** TypeScript, Fastify 5, MongoDB, Jest (lib), Vitest (API), `mongodb-memory-server`.

**Spec:** `specs/modulos-novos/20261012/resultado-dre.md` (aprovada em 12/10/2026).

## Global Constraints

- Nomes em inglês; commits em PT (conventional) com rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura ≥ 90% nas quatro métricas (`npm run test:ci`).
- Somas em centavos inteiros (`toCents`/`fromCents`); meses `AAAA-MM` civis em America/Sao_Paulo.
- Competência (`date`); canceladas fora; toda consulta com `restaurantId` do contexto.
- Classificação pela **categoria atual**; despesa sem grupo = `opex`; `dreGroup: 'tax'` fora do DRE.
- `MIXED_BEHAVIOR_AS = 'fixed'`; `HISTORY_MONTHS = 6`; nome do item sintético `'Taxa de plataforma'`.
- Variação: `(atual − anterior) / |anterior|`, anterior 0 → `null`.
- Lib: `feat` **sem** `!` (aditivo).
- Branches `feat/20261012/resultado-dre` nos dois repositórios (a da API já existe).

## Review Focus

1. **Mês sem nenhuma receita** (restaurante novo, mês antigo do histórico) — linhas zeradas, `netMargin`, `contributionMarginPct` e `breakEvenRevenue` `null`, sem `NaN`. → Tarefa 3 e 4.
2. **Prejuízo nos dois meses** — a variação do lucro tem que mostrar melhora quando o prejuízo diminui. → Tarefa 3.
3. **Lançamento cuja categoria não existe mais** (ou sem `dreGroup`) — entra como `opex` com o nome do lançamento, não some nem quebra. → Tarefa 3.
4. **MEI em mês anterior à primeira movimentação** — imposto 0, histórico sem prejuízo fantasma. → Tarefa 3.
5. **Receita às 22h do último dia do mês** — conta naquele mês no `$dateToString`. → Tarefa 5.

---

## File Structure

**MintlyLib**

| Arquivo | Responsabilidade |
|---|---|
| `src/core/data/reports/result-response.ts` | `ResultQuery`, `ResultLines`, `OpexItem`, `ResultInsight`, `ResultReport` |
| `src/core/data/reports/index.ts` | export |
| `src/clients/report-client.ts` | `result(query, headers)` |

**MintlyApi**

| Arquivo | Responsabilidade |
|---|---|
| `src/app/reports/shared/period.ts` | recebe `parseReferenceMonth` (sai de `restaurant/reference-month.ts`) |
| `src/app/reports/result/result-metrics.ts` | regra pura |
| `src/app/reports/result/result-repository.ts` | 3 consultas |
| `src/app/reports/result/use-cases/result.query.ts` | orquestra |
| `src/app/reports/result/result-controller.ts`, `result-routes.ts` | borda HTTP |
| `src/app/reports/result/result-scenario.ts` | cenário (integração + seed) |
| `src/infrastructure/server/build-server.ts` | registra o plugin |
| `scripts/app/seed-demo.ts` | `SEED_SCENARIO=result` |
| `tests/e2e/result.e2e.spec.ts`, `insomnia/MintlyApi.insomnia_v4.json` | E2E e Insomnia |

---

## Tarefa 1 — MintlyLib: contrato do Resultado e `ReportClient.result`

**Branch:** `git checkout staging && git pull && git checkout -b feat/20261012/resultado-dre`

**Files:** Create `src/core/data/reports/result-response.ts`; Modify `src/core/data/reports/index.ts`, `src/clients/report-client.ts`, `src/clients/report-client.spec.ts`.

**Interfaces — Produces:** tipos `ResultQuery { month?: string }`, `ResultLines`, `OpexItem`, `ResultInsight`, `ResultReport` (exatamente os da spec); `ReportClient.result(query: ResultQuery, headers): Promise<ResponseDto<ResultReport>>`.

- [ ] **Passo 1: Teste que falha** — em `report-client.spec.ts`, dentro do `describe`:

```ts
  it('result faz GET /result com o mês na query e devolve o envelope', async () => {
    const client = new ReportClient()
    const get = jest.spyOn((client as any).http.connection, 'get')
      .mockResolvedValue({ data: { payload: { referenceMonth: '2026-07' } } } as any)

    const res = await (client as any).result({ month: '2026-07' }, { env: 'staging', authorization: 'Bearer t' } as any)

    expect(get).toHaveBeenCalledWith('/result', expect.objectContaining({ params: { month: '2026-07' } }))
    expect(res.payload).toEqual({ referenceMonth: '2026-07' })
  })
```

- [ ] **Passo 2: Ver falhar** — `npx jest src/clients/report-client.spec.ts` → FAIL (`result is not a function`).

- [ ] **Passo 3: Tipos** — `src/core/data/reports/result-response.ts`:

```ts
import type { CategoryBehavior } from '../financial/financial-category-schema'
import type { TaxRegime } from '../restaurant/restaurant-schema'

/**
 * Contrato de GET /reports/result (fatia 4). DRE simplificado por competência.
 * Número cru; taxas e margens como fração (0.109 = 10,9%). Spec:
 * MintlyApi/specs/modulos-novos/20261012/resultado-dre.md.
 */

/** `month` em AAAA-MM; padrão o mês corrente no servidor. */
export interface ResultQuery {
  month?: string
}

export interface ResultLines {
  grossRevenue: number
  taxes: number
  netRevenue: number
  cmv: number
  grossMargin: number
  operatingExpenses: number
  netProfit: number
  netMargin: number | null
}

export type ResultLineKey = Exclude<keyof ResultLines, 'netMargin'>

/** Item da composição das despesas operacionais (categoria ou a taxa de plataforma). */
export interface OpexItem {
  categoryId: string | null
  name: string
  kind: 'labor' | 'opex' | 'platformFee'
  behavior: CategoryBehavior
  amount: number
  previousAmount: number
  delta: number | null
  revenuePct: number | null
}

export type ResultInsight =
  | { kind: 'profitChanged'; severity: 'positive' | 'warning'; difference: number; previousProfit: number; currentProfit: number; previousMargin: number | null; currentMargin: number | null }
  | { kind: 'largestOpexItem'; severity: 'warning'; name: string; amount: number; revenuePct: number | null }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

export interface ResultBreakEven {
  fixedCosts: number
  variableCosts: number
  contributionMarginPct: number | null
  breakEvenRevenue: number | null
  reachedOnDay: number | null
}

export interface ResultHistoryPoint {
  month: string
  grossRevenue: number
  netProfit: number
  netMargin: number | null
}

export interface ResultReport {
  referenceMonth: string
  previousMonth: string
  current: ResultLines
  previous: ResultLines
  deltas: Record<ResultLineKey, number | null>
  tax: { regime: TaxRegime | null; effectiveRate: number | null; meiMonthlyDas: number | null }
  operatingExpenseItems: OpexItem[]
  breakEven: ResultBreakEven
  history: ResultHistoryPoint[]
  insights: ResultInsight[]
}
```

`index.ts`: acrescente `export * from './result-response'`.

- [ ] **Passo 4: Client** — em `report-client.ts`, importe `ResultQuery, ResultReport` e acrescente:

```ts
  /** Resultado (DRE) do mês: linhas, composição, ponto de equilíbrio, histórico e insights. */
  async result (query: ResultQuery, headers: Headers): Promise<ResponseDto<ResultReport>> {
    const response = await this.http.connection.get<ResponseDto<ResultReport>>('/result', withHeaders(headers, { params: query }))
    return response.data
  }
```

(o `HttpBaseClient<CashFlowReport>` continua; o tipo genérico não restringe os GETs próprios.)
Tire o `(client as any)` do teste.

- [ ] **Passo 5: Ver passar + checagens** — `npx jest && npm run typecheck && npm run lint && npm run build` → verde; `node -e "console.log(Object.keys(require('./build/core/data/reports')))"` não precisa listar tipos (são só tipos).

- [ ] **Passo 6: Commit e push** — `git add src/core/data/reports src/clients/report-client.ts src/clients/report-client.spec.ts && git commit -m "feat(reports): contrato e client do Resultado (DRE)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin feat/20261012/resultado-dre`

---

## Tarefa 2 — MintlyApi: lib local e `parseReferenceMonth` em `reports/shared`

**Files:** Modify `src/app/reports/shared/period.ts` (+ spec); Delete `src/app/restaurant/reference-month.ts` e `reference-month.spec.ts`; Modify `src/app/restaurant/use-cases/get-restaurant-profile.query.ts`.

**Interfaces — Produces:** `parseReferenceMonth(value: string | undefined, now: Date): string` exportado de `src/app/reports/shared/period.ts`.

- [ ] **Passo 1: Build local da lib** — `cd ../MintlyLib && npm run build && cd ../MintlyApi && rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build`. Não commitar.

- [ ] **Passo 2: Mover os testes primeiro** — copie os `describe('parseReferenceMonth', …)` de `reference-month.spec.ts` para o fim de `period.spec.ts`, importando `parseReferenceMonth` de `'./period'` e `ValidationError` de `'../../../core/errors/core/validation-error'`. Apague `reference-month.spec.ts`.

- [ ] **Passo 3: Ver falhar** — `npx vitest run src/app/reports/shared/period.spec.ts` → FAIL (`parseReferenceMonth` não exportado).

- [ ] **Passo 4: Mover a função** — acrescente a `period.ts` (import de `ValidationError`):

```ts
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** `?month=AAAA-MM` dos relatórios e do /restaurants/me: padrão o mês corrente; futuro não existe. */
export function parseReferenceMonth (value: string | undefined, now: Date): string {
  const current = toLocalMonth(now)
  if (value == null) return current
  if (!MONTH.test(value)) throw new ValidationError('month inválido: use AAAA-MM.')
  if (value > current) throw new ValidationError('month não pode estar no futuro.')
  return value
}
```

Apague `src/app/restaurant/reference-month.ts`; em `get-restaurant-profile.query.ts` troque o import por `import { parseReferenceMonth } from '../../reports/shared/period'`.

- [ ] **Passo 5: Ver passar** — `npx vitest run src/app/reports/shared src/app/restaurant` → PASS.

- [ ] **Passo 6: Commit** — `git add -A src/app/reports/shared src/app/restaurant && git commit -m "refactor(reports): parseReferenceMonth em reports/shared (dois consumidores)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 3 — Regra pura: mês agregado, imposto, linhas e variações

**Files:** Create `src/app/reports/result/result-metrics.ts`, `src/app/reports/result/result-metrics.spec.ts`.

**Interfaces — Produces:**

```ts
export const MIXED_BEHAVIOR_AS: CategoryBehavior.Fixed | CategoryBehavior.Variable
export const HISTORY_MONTHS = 6
export const PLATFORM_FEE_NAME = 'Taxa de plataforma'
export interface MonthlyTotalRow { month: string; direction: 'in' | 'out'; categoryId: string; categoryName: string; gross: number; fee: number }
export interface CategoryInfo { id: string; name: string; dreGroup?: DreGroup; behavior: CategoryBehavior }
export interface MonthTax { effectiveRate: number | null; fixedAmount: number | null }
export interface MonthAggregate { grossRevenue: number; platformFee: number; cmv: number; opexCategories: Map<string, CategoryAmount>; fixed: number; variable: number }   // centavos
export interface CategoryAmount { categoryId: string; name: string; kind: 'labor' | 'opex'; behavior: CategoryBehavior; cents: number }
export function aggregateMonth (rows: MonthlyTotalRow[], month: string, categories: Map<string, CategoryInfo>): MonthAggregate
export function hasActivity (agg: MonthAggregate): boolean
export function monthTax (p: { regime: TaxRegime | null; month: string; firstMonth: string | null; revenueByMonth: Map<string, number>; meiMonthlyDas: number | null }): MonthTax
export function buildLines (agg: MonthAggregate, tax: MonthTax): ResultLines
export function relativeDelta (current: number, previous: number): number | null
export function buildDeltas (current: ResultLines, previous: ResultLines): Record<ResultLineKey, number | null>
```

- [ ] **Passo 1: Testes que falham** — `result-metrics.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CategoryBehavior, DreGroup, TaxRegime } from 'mintly-lib'
import { CategoryInfo, MonthlyTotalRow, aggregateMonth, buildDeltas, buildLines, hasActivity, monthTax, relativeDelta } from './result-metrics'

const M = '2026-07'
const cat = (id: string, dreGroup: DreGroup | undefined, behavior: CategoryBehavior, name = id): [string, CategoryInfo] => [id, { id, name, dreGroup, behavior }]
const CATS = new Map<string, CategoryInfo>([
  cat('cmv', DreGroup.Cmv, CategoryBehavior.Variable, 'CMV'),
  cat('pro', DreGroup.Labor, CategoryBehavior.Fixed, 'Pró-labore'),
  cat('alu', DreGroup.Opex, CategoryBehavior.Fixed, 'Aluguel'),
  cat('uti', DreGroup.Opex, CategoryBehavior.Mixed, 'Utilidades'),
  cat('mkt', DreGroup.Opex, CategoryBehavior.Variable, 'Marketing'),
  cat('imp', DreGroup.Tax, CategoryBehavior.Fixed, 'Impostos'),
  cat('leg', undefined, CategoryBehavior.Variable, 'Legada sem grupo'),
])
const row = (over: Partial<MonthlyTotalRow>): MonthlyTotalRow => ({ month: M, direction: 'out', categoryId: 'x', categoryName: 'x', gross: 0, fee: 0, ...over })

describe('aggregateMonth', () => {
  const rows = [
    row({ direction: 'in', categoryId: 'ven', gross: 1000, fee: 100 }),
    row({ categoryId: 'cmv', gross: 300 }),
    row({ categoryId: 'pro', gross: 200 }),
    row({ categoryId: 'uti', gross: 50 }),
    row({ categoryId: 'mkt', gross: 40 }),
    row({ categoryId: 'imp', gross: 999 }),
    row({ categoryId: 'leg', gross: 10 }),
    row({ categoryId: 'sumiu', categoryName: 'Categoria apagada', gross: 5 }),
    row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 7777 }),
  ]
  const agg = aggregateMonth(rows, M, CATS)

  it('receita bruta e taxa de plataforma das entradas do mês', () => {
    expect(agg.grossRevenue).toBe(100_000)
    expect(agg.platformFee).toBe(10_000)
  })

  it('CMV separado; imposto fora; sem grupo e categoria sumida viram opex', () => {
    expect(agg.cmv).toBe(30_000)
    expect([...agg.opexCategories.values()].map((c) => [c.name, c.kind, c.cents])).toEqual([
      ['Pró-labore', 'labor', 20_000],
      ['Utilidades', 'opex', 5_000],
      ['Marketing', 'opex', 4_000],
      ['Legada sem grupo', 'opex', 1_000],
      ['Categoria apagada', 'opex', 500],
    ])
  })

  it('fixo inclui misto e categoria sumida; variável inclui a taxa de plataforma', () => {
    // fixo: pró-labore 200 + utilidades 50 (misto) + sumida 5 (sem info → fixo)
    expect(agg.fixed).toBe(25_500)
    // variável: cmv 300 + marketing 40 + legada 10 + taxa 100
    expect(agg.variable).toBe(45_000)
  })

  it('mês sem movimento', () => {
    const empty = aggregateMonth(rows, '2026-01', CATS)
    expect(empty).toMatchObject({ grossRevenue: 0, platformFee: 0, cmv: 0, fixed: 0, variable: 0 })
    expect(hasActivity(empty)).toBe(false)
    expect(hasActivity(agg)).toBe(true)
  })
})

describe('monthTax', () => {
  const revenue = new Map([['2026-06', 33_000], ['2026-07', 58_400]])

  it('Simples: alíquota efetiva do mês (RBT12 proporcional)', () => {
    expect(monthTax({ regime: TaxRegime.SimplesNacionalAnexoI, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null }).effectiveRate)
      .toBeCloseTo(0.06, 10) // RBT12 = 33.000 × 12 = 396.000 → (396.000 × 9,5% − 13.860) / 396.000
  })

  it('MEI: DAS a partir do mês da primeira movimentação; antes, zero', () => {
    expect(monthTax({ regime: TaxRegime.Mei, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: 82.05 })).toEqual({ effectiveRate: null, fixedAmount: 82.05 })
    expect(monthTax({ regime: TaxRegime.Mei, month: '2026-05', firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: 82.05 })).toEqual({ effectiveRate: null, fixedAmount: 0 })
    expect(monthTax({ regime: TaxRegime.Mei, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null })).toEqual({ effectiveRate: null, fixedAmount: 0 })
  })

  it('sem regime', () => {
    expect(monthTax({ regime: null, month: M, firstMonth: '2026-06', revenueByMonth: revenue, meiMonthlyDas: null })).toEqual({ effectiveRate: null, fixedAmount: null })
  })
})

describe('buildLines', () => {
  const agg = aggregateMonth([
    row({ direction: 'in', categoryId: 'ven', gross: 58_400, fee: 6_044 }),
    row({ categoryId: 'cmv', gross: 21_024 }),
    row({ categoryId: 'pro', gross: 21_456 }),
  ], M, CATS)

  it('DRE com alíquota (o caso da print)', () => {
    expect(buildLines(agg, { effectiveRate: 0.06, fixedAmount: null })).toEqual({
      grossRevenue: 58_400,
      taxes: 3_504,
      netRevenue: 54_896,
      cmv: 21_024,
      grossMargin: 33_872,
      operatingExpenses: 27_500,
      netProfit: 6_372,
      netMargin: 6_372 / 58_400,
    })
  })

  it('MEI: imposto fixo; sem regime: zero', () => {
    expect(buildLines(agg, { effectiveRate: null, fixedAmount: 82.05 }).taxes).toBe(82.05)
    expect(buildLines(agg, { effectiveRate: null, fixedAmount: null }).taxes).toBe(0)
  })

  it('mês sem receita: margem null', () => {
    expect(buildLines(aggregateMonth([], M, CATS), { effectiveRate: 0.04, fixedAmount: null }))
      .toMatchObject({ grossRevenue: 0, taxes: 0, netProfit: 0, netMargin: null })
  })
})

describe('variações', () => {
  it('relativa com módulo no denominador', () => {
    expect(relativeDelta(110, 100)).toBeCloseTo(0.1, 10)
    expect(relativeDelta(-50, -100)).toBeCloseTo(0.5, 10) // prejuízo diminuiu → melhora
    expect(relativeDelta(10, 0)).toBeNull()
  })

  it('buildDeltas cobre as sete linhas e ignora a margem', () => {
    const lines = (v: number) => ({ grossRevenue: v, taxes: v, netRevenue: v, cmv: v, grossMargin: v, operatingExpenses: v, netProfit: v, netMargin: 0.1 })
    expect(buildDeltas(lines(120), lines(100))).toEqual({ grossRevenue: 0.2, taxes: 0.2, netRevenue: 0.2, cmv: 0.2, grossMargin: 0.2, operatingExpenses: 0.2, netProfit: 0.2 })
  })
})
```

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/reports/result/result-metrics.spec.ts` → FAIL (módulo não existe).

- [ ] **Passo 3: Implementar** — `result-metrics.ts`:

```ts
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
```

- [ ] **Passo 4: Ver passar** — mesmo comando → PASS. (Se `buildDeltas` sair com `0.19999999999999996`, troque o `toEqual` daquele teste por `toBeCloseTo` campo a campo — float da divisão, não da soma.)

- [ ] **Passo 5: Commit** — `git add src/app/reports/result && git commit -m "feat(reports): DRE do mes — agregacao, imposto, linhas e variacoes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 4 — Regra pura: composição, ponto de equilíbrio, insights e relatório

**Files:** Modify `result-metrics.ts` e `result-metrics.spec.ts`.

**Interfaces — Produces:** `buildOpexItems(current: MonthAggregate, previous: MonthAggregate): OpexItem[]`; `buildBreakEven(agg: MonthAggregate, lines: ResultLines, month: string, dailyRevenue: Map<string, number>): ResultBreakEven`; `buildInsights(p: { regime: TaxRegime | null; current: ResultLines; previous: ResultLines; previousHasActivity: boolean; items: OpexItem[] }): ResultInsight[]`; `ResultInput` e `computeResult(input: ResultInput): ResultReport`, com `ResultInput = { referenceMonth: string; regime: TaxRegime | null; rows: MonthlyTotalRow[]; categories: Map<string, CategoryInfo>; taxByMonth: Map<string, MonthTax>; meiMonthlyDas: number | null; dailyRevenue: Map<string, number> }`.

- [ ] **Passo 1: Testes que falham** — acrescente ao spec (e os nomes ao import):

```ts
describe('buildOpexItems', () => {
  const cur = aggregateMonth([
    row({ direction: 'in', categoryId: 'ven', gross: 10_000, fee: 600 }),
    row({ categoryId: 'pro', gross: 800 }),
    row({ categoryId: 'mkt', gross: 120 }),
    row({ categoryId: 'alu', gross: 120 }),
  ], M, CATS)
  const prev = aggregateMonth([
    row({ month: '2026-06', categoryId: 'pro', gross: 800 }),
    row({ month: '2026-06', categoryId: 'uti', gross: 200 }),
    row({ month: '2026-06', categoryId: 'mkt', gross: 90 }),
  ], '2026-06', CATS)

  it('categorias de M e M−1 + taxa de plataforma, do maior para o menor, empate por nome', () => {
    const items = buildOpexItems(cur, prev)
    expect(items.map((i) => [i.name, i.amount, i.previousAmount])).toEqual([
      ['Pró-labore', 800, 800],
      ['Taxa de plataforma', 600, 0],
      ['Aluguel', 120, 0],
      ['Marketing', 120, 90],
      ['Utilidades', 0, 200],
    ])
  })

  it('item com variação, % da receita, tipo e comportamento', () => {
    const items = buildOpexItems(cur, prev)
    expect(items[1]).toEqual({ categoryId: null, name: 'Taxa de plataforma', kind: 'platformFee', behavior: 'variable', amount: 600, previousAmount: 0, delta: null, revenuePct: 0.06 })
    expect(items[3]).toMatchObject({ categoryId: 'mkt', kind: 'opex', delta: 30 / 90 })
    expect(items[0]).toMatchObject({ kind: 'labor', delta: 0, revenuePct: 0.08 })
  })

  it('sem taxa nos dois meses: sem item sintético', () => {
    expect(buildOpexItems(prev, prev).some((i) => i.kind === 'platformFee')).toBe(false)
  })
})

describe('buildBreakEven', () => {
  // Fixos 17.656 (pró-labore 8.000 + aluguel 6.000 + utilidades 2.200 misto + contador 1.456)
  const agg = aggregateMonth([
    row({ direction: 'in', categoryId: 'ven', gross: 58_400, fee: 6_044 }),
    row({ categoryId: 'cmv', gross: 21_024 }),
    row({ categoryId: 'pro', gross: 8_000 }),
    row({ categoryId: 'alu', gross: 7_456 }),
    row({ categoryId: 'uti', gross: 2_200 }),
    row({ categoryId: 'mkt', gross: 3_800 }),
  ], M, CATS)
  const lines = buildLines(agg, { effectiveRate: 0.06, fixedAmount: null })
  const daily = new Map([['2026-07-01', 20_000], ['2026-07-10', 20_000], ['2026-07-20', 18_400]])

  it('margem de contribuição, ponto de equilíbrio e dia em que é atingido', () => {
    const be = buildBreakEven(agg, lines, M, daily)
    expect(be.fixedCosts).toBe(17_656)
    expect(be.variableCosts).toBe(21_024 + 3_800 + 6_044)
    expect(be.contributionMarginPct).toBeCloseTo((54_896 - 30_868) / 54_896, 10)
    expect(be.breakEvenRevenue).toBe(40_338.1)
    expect(be.reachedOnDay).toBe(20) // dia 10: 40.000 × 0,94 = 37.600 < 40.338,10
  })

  it('não alcançado no mês: null', () => {
    expect(buildBreakEven(agg, lines, M, new Map([['2026-07-01', 1_000]])).reachedOnDay).toBeNull()
  })

  it('sem custo fixo: alcançado no dia 1', () => {
    const variableOnly = aggregateMonth([row({ direction: 'in', categoryId: 'ven', gross: 1_000 }), row({ categoryId: 'mkt', gross: 100 })], M, CATS)
    expect(buildBreakEven(variableOnly, buildLines(variableOnly, { effectiveRate: null, fixedAmount: null }), M, new Map([['2026-07-01', 1_000]])))
      .toMatchObject({ breakEvenRevenue: 0, reachedOnDay: 1 })
  })

  it('margem de contribuição ≤ 0 ou sem receita: null', () => {
    const loss = aggregateMonth([row({ direction: 'in', categoryId: 'ven', gross: 100 }), row({ categoryId: 'mkt', gross: 500 })], M, CATS)
    expect(buildBreakEven(loss, buildLines(loss, { effectiveRate: null, fixedAmount: null }), M, new Map()))
      .toMatchObject({ contributionMarginPct: -4, breakEvenRevenue: null, reachedOnDay: null })
    const none = aggregateMonth([], M, CATS)
    expect(buildBreakEven(none, buildLines(none, { effectiveRate: null, fixedAmount: null }), M, new Map()))
      .toMatchObject({ contributionMarginPct: null, breakEvenRevenue: null, reachedOnDay: null })
  })
})

describe('buildInsights', () => {
  const lines = (netProfit: number, grossRevenue = 1_000) => ({ grossRevenue, taxes: 0, netRevenue: grossRevenue, cmv: 0, grossMargin: grossRevenue, operatingExpenses: grossRevenue - netProfit, netProfit, netMargin: netProfit / grossRevenue })
  const items = [{ categoryId: 'pro', name: 'Pró-labore', kind: 'labor' as const, behavior: CategoryBehavior.Fixed, amount: 800, previousAmount: 800, delta: 0, revenuePct: 0.08 }]

  it('lucro subiu: positive; maior despesa; regime configurado', () => {
    expect(buildInsights({ regime: TaxRegime.Mei, current: lines(300), previous: lines(100), previousHasActivity: true, items })).toEqual([
      { kind: 'profitChanged', severity: 'positive', difference: 200, previousProfit: 100, currentProfit: 300, previousMargin: 0.1, currentMargin: 0.3 },
      { kind: 'largestOpexItem', severity: 'warning', name: 'Pró-labore', amount: 800, revenuePct: 0.08 },
    ])
  })

  it('lucro caiu: warning; sem mês anterior: sem profitChanged; sem regime: aviso', () => {
    expect(buildInsights({ regime: TaxRegime.Mei, current: lines(50), previous: lines(100), previousHasActivity: true, items: [] })[0]).toMatchObject({ kind: 'profitChanged', severity: 'warning', difference: -50 })
    expect(buildInsights({ regime: null, current: lines(50), previous: lines(0, 0), previousHasActivity: false, items: [] }))
      .toEqual([{ kind: 'taxRegimeNotConfigured', severity: 'info' }])
  })
})

describe('computeResult', () => {
  it('monta o relatório com 6 meses de histórico (meses vazios inclusive)', () => {
    const report = computeResult({
      referenceMonth: M,
      regime: TaxRegime.SimplesNacionalAnexoI,
      rows: [
        row({ direction: 'in', categoryId: 'ven', gross: 58_400, fee: 6_044 }),
        row({ categoryId: 'cmv', gross: 21_024 }),
        row({ categoryId: 'pro', gross: 21_456 }),
        row({ month: '2026-06', direction: 'in', categoryId: 'ven', gross: 33_000 }),
      ],
      categories: CATS,
      taxByMonth: new Map([[M, { effectiveRate: 0.06, fixedAmount: null }], ['2026-06', { effectiveRate: 0.06, fixedAmount: null }]]),
      meiMonthlyDas: null,
      dailyRevenue: new Map([['2026-07-05', 58_400]]),
    })

    expect(report).toMatchObject({
      referenceMonth: M,
      previousMonth: '2026-06',
      current: { grossRevenue: 58_400, taxes: 3_504, netProfit: 6_372 },
      previous: { grossRevenue: 33_000, taxes: 1_980, netProfit: 31_020 },
      tax: { regime: TaxRegime.SimplesNacionalAnexoI, effectiveRate: 0.06, meiMonthlyDas: null },
    })
    expect(report.history.map((h) => h.month)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
    expect(report.history[0]).toEqual({ month: '2026-02', grossRevenue: 0, netProfit: 0, netMargin: null })
    expect(report.deltas.grossRevenue).toBeCloseTo((58_400 - 33_000) / 33_000, 10)
    expect(report.insights.map((i) => i.kind)).toEqual(['profitChanged', 'largestOpexItem'])
  })
})
```

- [ ] **Passo 2: Ver falhar** — mesmo comando → FAIL (`buildOpexItems is not a function`).

- [ ] **Passo 3: Implementar** — acrescente a `result-metrics.ts` (imports: `OpexItem, ResultBreakEven, ResultInsight, ResultReport` de `mintly-lib`; `addMonths` de `'../shared/period'`):

```ts
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
 * Ponto de equilíbrio de M (spec): fixos ÷ margem de contribuição. O dia em que é
 * atingido compara a receita bruta acumulada convertida em líquida pela proporção
 * do mês. Sem margem positiva, nenhuma venda paga os fixos → null.
 */
export function buildBreakEven (agg: MonthAggregate, lines: ResultLines, month: string, dailyRevenue: Map<string, number>): ResultBreakEven {
  const netCents = toCents(lines.netRevenue)
  const contributionMarginPct = netCents > 0 ? (netCents - agg.variable) / netCents : null
  const breakEvenCents = contributionMarginPct != null && contributionMarginPct > 0 ? Math.round(agg.fixed / contributionMarginPct) : null

  let reachedOnDay: number | null = null
  if (breakEvenCents != null && agg.grossRevenue > 0) {
    const toNet = netCents / agg.grossRevenue
    let accumulated = 0
    for (let d = 1; d <= daysInMonth(month); d++) {
      accumulated += toCents(dailyRevenue.get(`${month}-${String(d).padStart(2, '0')}`) ?? 0)
      if (accumulated * toNet >= breakEvenCents) {
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
```

- [ ] **Passo 4: Ver passar + cobertura** — `npx vitest run src/app/reports/result --coverage --coverage.include='src/app/reports/result/result-metrics.ts'` → PASS e 100% de branches (escreva o teste do ramo que faltar). O `breakEvenRevenue` de 40.338,10 vem de `round(1.765.600 / (2.402.800 / 5.489.600))` = 4.033.810 centavos.

- [ ] **Passo 5: Commit** — `git add src/app/reports/result && git commit -m "feat(reports): composicao, ponto de equilibrio, insights e relatorio do DRE" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 5 — Repositório, query, rota e cenário

**Files:** Create `result-repository.ts`, `use-cases/result.query.ts`, `result-controller.ts`, `result-routes.ts`, `result-scenario.ts`, `result.int.spec.ts`; Modify `src/infrastructure/server/build-server.ts`.

**Interfaces — Consumes:** Tarefas 2–4; `TaxRepository`, `TaxSettingsRepository` (fatia 3); `RestaurantRepository.findMine` (fatia 3). **Produces:** `ResultRepository.monthlyTotals(ctx, { from, to }): Promise<MonthlyTotalRow[]>`, `.categories(ctx): Promise<Map<string, CategoryInfo>>`, `.dailyRevenue(ctx, month): Promise<Map<string, number>>`; `ResultQuery.execute(ctx, month?)`; `GET /reports/result`; `RESULT_SEED_MARKER`, `resultScenario(month, restaurantId)`, `resultScenarioExpected(month)`.

- [ ] **Passo 1: Cenário** — `result-scenario.ts`. M é o mês consultado (os testes e o seed usam **o mês anterior ao corrente**, para não haver data no futuro); P = M−1.

```ts
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

type Def = { key: string; name: string; type: 'revenue' | 'expense'; dreGroup?: string; behavior: string }
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

type Line = { month: 0 | -1; day: number; key: string; title: string; gross: number; fee?: number; platform?: boolean }
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
```

- [ ] **Passo 2: Testes de integração que falham** — `result.int.spec.ts` (mesmo `beforeAll`/`afterAll`/`signup` dos `int.spec` de relatório):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { toDecimal128 } from '../../../core/money/money'
import { addMonths, startOfLocalMonth, toLocalMonth } from '../shared/period'
import { resultScenario, resultScenarioExpected } from './result-scenario'

let envCounter = 0
const freshEnv = () => `int_result_${++envCounter}`

describe('GET /reports/result (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance
  const M = addMonths(toLocalMonth(new Date()), -1)

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  async function signup (env: string, tag = 'a') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `res_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  async function plant (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const { categories, movements } = resultScenario(M, restaurantId)
    await db.collection('financial_categories').insertMany(categories)
    await db.collection('financial_movements').insertMany(movements)
    await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })
  }

  const get = (auth: Record<string, string>, query = `?month=${M}`) => app.inject({ method: 'GET', url: `/reports/result${query}`, headers: auth })

  it('confere o cenário linha a linha', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    const expected = resultScenarioExpected(M)

    const res = await get(auth)

    expect(res.statusCode).toBe(200)
    const r = res.json().payload
    expect(r).toMatchObject({ referenceMonth: M, previousMonth: expected.previousMonth, current: expected.current, previous: expected.previous })
    expect(r.tax.effectiveRate).toBeCloseTo(expected.effectiveRate, 10)
    expect(r.operatingExpenseItems.map((i: any) => i.name)).toEqual(expected.itemNames)
    expect(r.breakEven).toMatchObject(expected.breakEven)
    expect(r.history).toHaveLength(6)
    expect(r.history[5]).toMatchObject({ month: M, netProfit: 6_372 })
    expect(r.insights.map((i: any) => i.kind)).toEqual(expected.insightKinds)
  })

  it('reclassificar a categoria muda o DRE do mês passado', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    await mongoConnection.getDatabase(env).collection('financial_categories').updateOne({ restaurantId, name: 'Demo · Marketing' }, { $set: { dreGroup: 'cmv' } })

    const r = (await get(auth)).json().payload

    expect(r.current).toMatchObject({ cmv: 22_224, operatingExpenses: 26_300 })
    expect(r.previous).toMatchObject({ cmv: 14_900, operatingExpenses: 14_000 })
  })

  it('receita às 22h do último dia conta no próprio mês', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertOne({
      restaurantId, title: 'Noite', direction: 'in', status: 'settled', statusSource: 'auto',
      date: new Date(startOfLocalMonth(addMonths(M, 1)).getTime() - 2 * 3_600_000),
      grossValue: toDecimal128(1_000), feeValue: toDecimal128(0), netValue: toDecimal128(1_000),
      account: { _id: 'a', name: 'Caixa', type: 'cash' }, category: { _id: 'c', name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const r = (await get(auth)).json().payload

    expect(r.current.grossRevenue).toBe(1_000)
    expect(r.insights).toContainEqual({ kind: 'taxRegimeNotConfigured', severity: 'info' })
  })

  it('dois restaurantes no mesmo ambiente não se misturam', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(env, a.restaurantId)

    const rb = (await get(b.auth)).json().payload

    expect(rb.current).toMatchObject({ grossRevenue: 0, netProfit: 0 })
    expect(rb.operatingExpenseItems).toEqual([])
  })

  it.each(['?month=2026-13', '?month=2026-1', 'FUTURE'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    const query = q === 'FUTURE' ? `?month=${addMonths(M, 2)}` : q
    expect((await get(auth, query)).statusCode).toBe(400)
  })

  it('sem month: mês corrente; sem token → 401', async () => {
    const { auth } = await signup(freshEnv())
    expect((await get(auth, '')).json().payload.referenceMonth).toBe(toLocalMonth(new Date()))
    expect((await app.inject({ method: 'GET', url: '/reports/result', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })
})
```

- [ ] **Passo 3: Ver falhar** — `npx vitest run src/app/reports/result/result.int.spec.ts` → FAIL (404).

- [ ] **Passo 4: Repositório**

```ts
import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth } from '../shared/period'
import { CategoryInfo, MonthlyTotalRow } from './result-metrics'

/**
 * Consultas do Resultado (spec, "Consultas"). Somas por competência no fuso de SP,
 * sem canceladas, sempre com restaurantId do contexto.
 */
export class ResultRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  private monthRange (from: string, to: string) {
    return { $gte: startOfLocalMonth(from), $lt: startOfLocalMonth(addMonths(to, 1)) }
  }

  /** Σ grossValue e Σ feeValue por mês × direção × categoria em [from, to]. */
  async monthlyTotals (ctx: RequestContext, w: { from: string; to: string }): Promise<MonthlyTotalRow[]> {
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled }, date: this.monthRange(w.from, w.to) } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } },
            direction: '$direction',
            categoryId: '$category._id',
          },
          gross: { $sum: '$grossValue' },
          fee: { $sum: '$feeValue' },
          categoryName: { $first: '$category.name' },
        },
      },
    ]).toArray()

    return rows.map((r) => ({
      month: r._id.month,
      direction: r._id.direction === MovementDirection.In ? 'in' : 'out',
      categoryId: String(r._id.categoryId),
      categoryName: r.categoryName ?? '',
      gross: decimalToNumber(r.gross),
      fee: decimalToNumber(r.fee),
    }))
  }

  /** Todas as categorias do restaurante (inativa também pode ter lançamento antigo). */
  async categories (ctx: RequestContext): Promise<Map<string, CategoryInfo>> {
    const docs = await this.db(ctx).collection('financial_categories')
      .find({ restaurantId: ctx.restaurantId }, { projection: { name: 1, dreGroup: 1, behavior: 1 } })
      .toArray()
    return new Map(docs.map((d) => [String(d._id), { id: String(d._id), name: d.name, dreGroup: d.dreGroup, behavior: d.behavior }]))
  }

  /** Receita bruta por dia (AAAA-MM-DD) do mês. */
  async dailyRevenue (ctx: RequestContext, month: string): Promise<Map<string, number>> {
    const rows = await this.db(ctx).collection('financial_movements').aggregate([
      { $match: { restaurantId: ctx.restaurantId, direction: MovementDirection.In, status: { $ne: MovementStatus.Cancelled }, date: this.monthRange(month, month) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIME_ZONE } }, total: { $sum: '$grossValue' } } },
    ]).toArray()
    return new Map(rows.map((r) => [String(r._id), decimalToNumber(r.total)]))
  }
}
```

- [ ] **Passo 5: Query, controller, rota**

`use-cases/result.query.ts`:

```ts
import { ResultReport, TaxRegime } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addMonths, parseReferenceMonth } from '../../shared/period'
import { RestaurantRepository } from '../../../restaurant/restaurant-repository'
import { TaxRepository } from '../../../tax/tax-repository'
import { TaxSettingsRepository } from '../../../tax/tax-settings-repository'
import { ResultRepository } from '../result-repository'
import { HISTORY_MONTHS, computeResult, monthTax } from '../result-metrics'

/**
 * Resultado (DRE): resolve o mês, lê o regime, soma por mês × categoria, calcula o
 * imposto de cada mês com a regra da fatia 3 e entrega à regra pura. Read-only.
 */
export class ResultQuery {
  constructor (
    private readonly repo: ResultRepository = new ResultRepository(),
    private readonly restaurants: RestaurantRepository = new RestaurantRepository(),
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly settings: TaxSettingsRepository = new TaxSettingsRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, month?: string): Promise<ResultReport> {
    const referenceMonth = parseReferenceMonth(month, this.clock())
    const from = addMonths(referenceMonth, -(HISTORY_MONTHS - 1))
    const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(from, i))

    const restaurant = await this.restaurants.findMine(ctx)
    const regime: TaxRegime | null = restaurant.taxRegime ?? null

    const [rows, categories, dailyRevenue, firstMonth, revenueByMonth, dasByMonth] = await Promise.all([
      this.repo.monthlyTotals(ctx, { from, to: referenceMonth }),
      this.repo.categories(ctx),
      this.repo.dailyRevenue(ctx, referenceMonth),
      this.taxRepo.firstMovementMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(from, -13), to: referenceMonth }),
      regime === TaxRegime.Mei
        ? Promise.all(months.map(async (m) => [m, await this.settings.meiMonthlyDasAt(m)] as const)).then((e) => new Map(e))
        : Promise.resolve(new Map<string, number | null>()),
    ])

    const taxByMonth = new Map(months.map((m) => [m, monthTax({ regime, month: m, firstMonth, revenueByMonth, meiMonthlyDas: dasByMonth.get(m) ?? null })]))

    return computeResult({ referenceMonth, regime, rows, categories, taxByMonth, meiMonthlyDas: dasByMonth.get(referenceMonth) ?? null, dailyRevenue })
  }
}
```

`result-controller.ts`:

```ts
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { ResultQuery } from './use-cases/result.query'

export class ResultController {
  constructor (private readonly query: ResultQuery = new ResultQuery()) {}

  /** GET /reports/result?month=AAAA-MM */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const report = await this.query.execute(ctx, (request.query ?? {}).month)
    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
```

`result-routes.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { ResultController } from './result-controller'

export async function resultRoutes (fastify: FastifyInstance) {
  const controller = new ResultController()

  // GET /reports/result?month=AAAA-MM — DRE do mês (fatia 4). Mês inválido ou futuro → 400.
  fastify.get('/result', async (request: any, reply) => controller.get(request, reply))
}
```

Em `build-server.ts`: importe `resultRoutes` de `'../../app/reports/result/result-routes'` e registre
`await protectedScope.register(resultRoutes, { prefix: '/reports' })` logo após o `cashFlowRoutes`.

- [ ] **Passo 6: Ver passar** — `npx vitest run src/app/reports/result` → PASS.

- [ ] **Passo 7: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 8: Commit** — `git add src/app/reports/result src/infrastructure/server/build-server.ts && git commit -m "feat(reports): GET /reports/result (DRE)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 6 — Seed, E2E e Insomnia

**Files:** Modify `scripts/app/seed-demo.ts`, `insomnia/MintlyApi.insomnia_v4.json`; Create `tests/e2e/result.e2e.spec.ts`.

- [ ] **Passo 1: Seed** — em `seed-demo.ts`, aceite `SEED_SCENARIO=result` (a lista de válidos passa a `cash-flow | tax | result`) e acrescente:

```ts
async function seedResult (db: Db, env: string, restaurantId: string): Promise<void> {
  const month = addMonths(toLocalMonth(new Date()), -1)
  await db.collection('financial_movements').deleteMany({ restaurantId, description: RESULT_SEED_MARKER })
  await db.collection('financial_categories').deleteMany({ restaurantId, name: /^Demo · / })

  const { categories, movements } = resultScenario(month, restaurantId)
  await db.collection('financial_categories').insertMany(categories)
  await db.collection('financial_movements').insertMany(movements)
  await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })

  console.log(`Plantados: ${categories.length} categorias, ${movements.length} movimentos; regime Simples (env=${env}, restaurante=${restaurantId}).`)
  console.log(`Esperado em GET /reports/result?month=${month}:`)
  console.log(JSON.stringify(resultScenarioExpected(month), null, 2))
}
```

(imports: `addMonths` de period, `RESULT_SEED_MARKER, resultScenario, resultScenarioExpected` de `../../src/app/reports/result/result-scenario`; atualize o comentário de uso e a mensagem de erro do `SEED_SCENARIO`).

- [ ] **Passo 2: Verificar** — script scratch contra Mongo em memória (como na fatia 3): signup, `SEED_SCENARIO=result` duas vezes, `GET /reports/result?month=<M>` confere `resultScenarioExpected` (linhas, itens, equilíbrio). `npx eslint scripts --ext .ts` e `npm run typecheck` limpos.

- [ ] **Passo 3: E2E** — `tests/e2e/result.e2e.spec.ts` no padrão de `cash-flow.e2e.spec.ts` (signup no env `e2e`, `listen`, `dropDatabase` no fim); lê `cashId`, a categoria de receita (`type: 'revenue'`) e a `CMV/Insumos`:

```ts
  it('receita e CMV aparecem no DRE do mês por HTTP real', async () => {
    const post = (body: Record<string, unknown>) => fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ date: new Date().toISOString(), accountId: cashId, paymentMethod: 'pix', ...body }) })
    expect((await post({ direction: 'in', title: 'Vendas E2E', grossValue: 1000, categoryId: revenueCatId })).status).toBe(201)
    expect((await post({ direction: 'out', title: 'Insumos E2E', grossValue: 300, categoryId: cmvCatId })).status).toBe(201)

    const res = await fetch(`${baseUrl}/reports/result`, { headers: auth })
    expect(res.status).toBe(200)
    const r = (await res.json() as any).payload
    expect(r.current).toMatchObject({ grossRevenue: 1000, taxes: 0, cmv: 300, grossMargin: 700, operatingExpenses: 0, netProfit: 700 })
    expect(r.insights).toContainEqual({ kind: 'taxRegimeNotConfigured', severity: 'info' })
  })
```

`npm run test:e2e` → todos verdes.

- [ ] **Passo 4: Insomnia** — na pasta `Reports` (`fld_reports`): `GET {{ _.base_url }}/reports/result` (nome `Resultado (DRE)`, descrição `?month=AAAA-MM opcional`), mesmos headers; via `json.load`/`json.dump(indent=2, ensure_ascii=False)`, diff só acrescenta.

- [ ] **Passo 5: Commit** — `git add scripts/app/seed-demo.ts tests/e2e/result.e2e.spec.ts insomnia/MintlyApi.insomnia_v4.json && git commit -m "test(reports): seed do DRE, E2E e insomnia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 7 — Fechar a fatia

- [ ] **Passo 1:** PR da lib (`gh pr create --base staging --title "feat(reports): contrato e client do Resultado (DRE)"`); aguardar o merge.
- [ ] **Passo 2:** `npm i mintly-lib@<versão publicada>` na API → `npm run lint && npm run typecheck && npm run test:ci` → commit `chore(deps): consome mintly-lib <versão> (resultado)`.
- [ ] **Passo 3:** `andamento.md` (fatia 4 em review, pendências da revisão, Jira: história da fatia 4 a criar) → commit `docs(modulos-novos): andamento da fatia 4`.
- [ ] **Passo 4:** PR da API (`gh pr create --base staging --title "feat(reports): Resultado (DRE)"`) com contrato, regra, decisões R1–R6, validação e "nenhum comando novo".
- [ ] **Passo 5:** `gh pr checks <n>` → verde.

---

## Self-review

- **Cobertura da spec:** contrato → T1; `parseReferenceMonth` compartilhado → T2; linhas, imposto (Simples/MEI/sem regime, MEI antes da 1ª movimentação), `tax` fora, sem grupo como opex, variações → T3; composição, ponto de equilíbrio (misto como fixo, `reachedOnDay`), insights, histórico → T4; consultas, rota, cenário, integração (reclassificação, 22h, isolamento, 400/401) → T5; seed, E2E, Insomnia → T6; entrega → T7.
- **Placeholders:** nenhum.
- **Tipos:** `MonthlyTotalRow`, `CategoryInfo`, `MonthTax`, `MonthAggregate` (T3) são os de T4 e T5; `ResultReport`/`OpexItem`/`ResultInsight`/`ResultBreakEven` (T1) os de T3–T5.
- **Números:** cenário conferido à mão no comentário de `result-scenario.ts`; `breakEvenRevenue` 40.338,10 = round(1.765.600 × 5.489.600 / 2.402.800) centavos.
- **Review Focus:** os cinco têm teste — mês sem receita (T3, T4), prejuízo nos dois meses (T3 `relativeDelta`), categoria sumida/sem grupo (T3), MEI antes da 1ª movimentação (T3), 22h do último dia (T5).
