# Fatia 3 — Classificação contábil e regime tributário — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo é uma ação de 2 a 5
> minutos, na ordem escrever o teste que falha → ver falhar → implementar o mínimo
> → ver passar → commitar. Não pule o "ver falhar".

**Goal:** dar à categoria a classificação contábil (`dreGroup`, `mixed`) e ao restaurante o
regime tributário, com o cálculo da MIN-23 (alíquota efetiva do Anexo I, MEI, RBT12 e alertas)
exposto em `GET /restaurants/me`.

**Architecture:** contratos na lib (união discriminada na categoria, `TaxRegime` no restaurante,
`RestaurantTaxProfile`); na API, regra pura em `src/app/tax/tax-rules.ts` e
`src/app/financial-category/category-rules.ts`, repositórios finos, módulo novo
`src/app/restaurant/`. Imposto calculado na hora, nada em cache.

**Tech Stack:** TypeScript, Fastify 5, MongoDB (driver nativo), Sapphire, Jest (lib), Vitest
(API), `mongodb-memory-server`.

**Spec:** `specs/modulos-novos/20261012/classificacao-contabil.md` (aprovada em 12/10/2026).

## Global Constraints

- Nomes em inglês; campos camelCase; collections snake_case plural; commits em PT (conventional), rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura mínima 90% nas quatro métricas (`npm run test:ci`).
- Lib: commits de categoria e restaurante com `!` e rodapé `BREAKING CHANGE:`.
- Meses são `AAAA-MM` civis em America/Sao_Paulo; nunca derivar mês de `toISOString()`.
- Limites das faixas são inclusivos: R$ 180.000,00 é faixa 1.
- RBT12 soma `grossValue` de entradas não canceladas (pendentes contam), por `date`.
- `MEI_ANNUAL_LIMIT = 81000`, `MEI_MONTHLY_LIMIT = 6750`, `MEI_CAP_WARNING_PCT = 0.8`, `SIMPLES_LIMIT = 4800000`.
- O valor do DAS do MEI **nunca** é escrito no código: vem de `app.tax_settings`.
- Toda leitura do restaurante e da receita usa `ctx.restaurantId`.
- Branches `feat/20261012/classificacao-contabil` nos dois repositórios (a da API já existe).

## Review Focus

1. **Categoria antiga com campo fora do schema** — a validação pela união do documento resultante na edição não pode passar a recusar edição de categorias reais. → Tarefa 4 testa edição de categoria criada pelo onboarding e por `POST`.
2. **Restaurante sem nenhuma movimentação** — perfil tem que sair com RBT12 0, alíquota 4% (Simples) e sem divisão por zero. → Tarefa 5 e Tarefa 8.
3. **Receita lançada às 22h do último dia do mês** tem que contar naquele mês, no Mongo (`$dateToString` com timezone) e no TS. → Tarefa 7.
4. **`month` no formato errado ou futuro** (`2026-13`, `2026-1`, mês seguinte) → 400, não 500 nem perfil vazio. → Tarefa 8.
5. **DAS não semeado para o mês** (MEI) — perfil sai com `meiMonthlyDas: null`, sem quebrar. → Tarefa 7.

---

## File Structure

**MintlyLib**

| Arquivo | Responsabilidade |
|---|---|
| `src/core/data/financial/financial-category-schema.ts` | `Mixed`, `DreGroup`, união discriminada, insert/update com `dreGroup?` |
| `src/core/data/restaurant/restaurant-schema.ts` | `TaxRegime`, `taxRegime?`, `restaurantUpdateSchema` |
| `src/core/data/restaurant/restaurant-tax.ts` | `TaxBracket`, `RestaurantTaxProfile`, `TaxInsight`, request/response do `/me` |
| `src/core/data/restaurant/index.ts` | exports |
| `src/clients/restaurant-client.ts` | compõe; `me()` e `updateMe()` |

**MintlyApi**

| Arquivo | Responsabilidade |
|---|---|
| `src/app/financial-category/category-rules.ts` | `resolveInsertDreGroup`, `resolveCategoryUpdate`, `SYSTEM_CATEGORY_DRE_GROUPS` |
| `src/app/financial-category/financial-category-controller.ts` | insert/update pela regra |
| `src/app/financial-category/financial-category-repository.ts` | `updateCategory` com `$unset` |
| `src/app/auth/use-cases/register-use-case.ts` | categorias de sistema com grupo |
| `src/app/reports/shared/period.ts` | `toLocalMonth`, `addMonths`, `diffMonths`, `startOfLocalMonth` |
| `src/app/tax/tax-rules.ts` | regra tributária pura |
| `src/app/tax/tax-repository.ts` | receita por mês e primeiro mês |
| `src/app/tax/tax-settings-repository.ts` | DAS vigente em `app.tax_settings` |
| `src/app/tax/tax-profile.query.ts` | monta o perfil |
| `src/app/tax/tax-scenario.ts` | cenário tributário (integração + seed) |
| `src/app/restaurant/*` | repositório, use-cases, controller, rotas `/restaurants/me` |
| `scripts/movements/backfill-dre-group.ts`, `scripts/app/seed-tax-settings.ts` | scripts |
| `scripts/app/seed-demo.ts` | `SEED_SCENARIO=tax` |

---

## Tarefa 1 — MintlyLib: categoria com `dreGroup` e `mixed`

**Branch:** `git checkout staging && git pull && git checkout -b feat/20261012/classificacao-contabil`

**Files:** Modify `src/core/data/financial/financial-category-schema.ts`; Test `src/core/data/financial/financial-category-schema.spec.ts`.

**Interfaces — Produces:** `CategoryBehavior.Mixed = 'mixed'`; `enum DreGroup { Cmv = 'cmv', Labor = 'labor', Tax = 'tax', Opex = 'opex' }`; `financialCategorySchema` = união revenue | expense (expense exige `dreGroup`); `financialCategoryInsertSchema` e `financialCategoryUpdateSchema` com `dreGroup?`.

- [ ] **Passo 1: Testes que falham** — no fim do spec (importe `DreGroup`):

```ts
describe('dreGroup e mixed (fatia 3)', () => {
  const expense = { ...baseCategory, name: 'CMV/Insumos', type: CategoryType.Expense }

  it('despesa exige dreGroup', () => {
    expect(financialCategorySchema.safeParse(expense).success).toBe(false)
    expect(financialCategorySchema.safeParse({ ...expense, dreGroup: DreGroup.Cmv }).success).toBe(true)
  })

  it('receita não aceita dreGroup', () => {
    expect(financialCategorySchema.safeParse({ ...baseCategory, dreGroup: DreGroup.Opex }).success).toBe(false)
    expect(financialCategorySchema.safeParse(baseCategory).success).toBe(true)
  })

  it('aceita behavior mixed', () => {
    expect(financialCategorySchema.safeParse({ ...expense, dreGroup: DreGroup.Opex, behavior: CategoryBehavior.Mixed }).success).toBe(true)
  })

  it('rejeita dreGroup desconhecido', () => {
    expect(financialCategorySchema.safeParse({ ...expense, dreGroup: 'outro' }).success).toBe(false)
  })

  it('insert e update aceitam dreGroup opcional', () => {
    expect(financialCategoryInsertSchema.safeParse({ name: 'X', type: CategoryType.Expense, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.Operational, status: RecordStatus.Active }).success).toBe(true)
    expect(financialCategoryInsertSchema.safeParse({ name: 'X', type: CategoryType.Expense, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.Operational, status: RecordStatus.Active, dreGroup: DreGroup.Labor }).success).toBe(true)
    expect(financialCategoryUpdateSchema.safeParse({ dreGroup: DreGroup.Tax }).success).toBe(true)
    expect(financialCategoryUpdateSchema.safeParse({ dreGroup: 'outro' }).success).toBe(false)
  })
})
```

(acrescente `financialCategoryInsertSchema` e `DreGroup` ao import.)

- [ ] **Passo 2: Ver falhar** — `npx jest src/core/data/financial/financial-category-schema.spec.ts -t "dreGroup e mixed"` → FAIL (`DreGroup` indefinido).

- [ ] **Passo 3: Implementar** — em `financial-category-schema.ts`:

```ts
export enum CategoryBehavior {
  Fixed = 'fixed',
  Variable = 'variable',
  /** Parte fixa, parte variável (ex.: utilidades). No ponto de equilíbrio: N8, fatia 4. */
  Mixed = 'mixed',
}

/**
 * Classificação contábil da DESPESA no DRE (M2). Só existe em categoria de
 * despesa — por isso a união discriminada por `type` abaixo.
 *  - cmv: ingredientes e insumos (margem bruta)
 *  - labor: pró-labore e salários (prime cost)
 *  - tax: imposto — sai da despesa operacional; o DRE deduz pela alíquota (M5)
 *  - opex: demais despesas operacionais
 */
export enum DreGroup {
  Cmv = 'cmv',
  Labor = 'labor',
  Tax = 'tax',
  Opex = 'opex',
}
```

Troque `export const financialCategorySchema = s.object({...})` por `const baseCategorySchema = s.object({...})` **sem** o campo `type` (o resto idêntico), e acrescente:

```ts
// União discriminada por `type` (mesmo recurso do financialAccountSchema): só
// despesa tem dreGroup, e nela ele é obrigatório. O Sapphire não tem `refine`,
// então é assim que a coerência tipo × grupo fica no contrato.
const revenueCategorySchema = baseCategorySchema.extend({
  type: s.type().literal(CategoryType.Revenue),
})

const expenseCategorySchema = baseCategorySchema.extend({
  type: s.type().literal(CategoryType.Expense),
  dreGroup: s.type().enum(DreGroup),
})

export const financialCategorySchema = s.type().union([revenueCategorySchema, expenseCategorySchema])
```

Em `financialCategoryUpdateSchema` e `financialCategoryInsertSchema`, acrescente
`dreGroup: s.type().enum(DreGroup),` (no update o `.partial()` já o torna opcional; no insert
use `.optional()`), com o comentário: `// opcional: a API completa com 'opex' em despesa e recusa em receita`.

- [ ] **Passo 4: Ver passar** — `npx jest src/core/data/financial` → PASS (inclusive os testes antigos, cuja fixture é receita).

- [ ] **Passo 5: Commit**

```bash
git add src/core/data/financial/financial-category-schema.ts src/core/data/financial/financial-category-schema.spec.ts
git commit -m "feat(categoria)!: dreGroup e behavior mixed (M2)" -m "BREAKING CHANGE: categoria de despesa gravada passa a exigir dreGroup (uniao discriminada por type)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 2 — MintlyLib: regime tributário, perfil e `RestaurantClient`

**Files:** Modify `src/core/data/restaurant/restaurant-schema.ts`, `src/core/data/restaurant/index.ts`, `src/clients/restaurant-client.ts`; Create `src/core/data/restaurant/restaurant-tax.ts`, `src/core/data/restaurant/restaurant-schema.spec.ts`, `src/clients/restaurant-client.spec.ts`; Modify `src/clients/client-shape.spec.ts` se ele afirmar CRUD no `RestaurantClient`.

**Interfaces — Produces:** `enum TaxRegime { Mei = 'mei', SimplesNacionalAnexoI = 'simplesNacionalAnexoI' }`; `restaurantSchema` com `taxRegime?`; `restaurantUpdateSchema`; tipos `TaxBracket`, `TaxInsight`, `RestaurantTaxProfile`, `RestaurantProfileQuery`, `RestaurantProfileResponse`, `RestaurantUpdateRequest`; `RestaurantClient.me(query, headers)` e `.updateMe(body, headers)`.

- [ ] **Passo 1: Testes que falham**

`src/core/data/restaurant/restaurant-schema.spec.ts`:

```ts
import { restaurantSchema, restaurantUpdateSchema, TaxRegime } from './restaurant-schema'

const audit = { createdAt: new Date('2026-10-01T00:00:00.000Z'), updatedAt: new Date('2026-10-01T00:00:00.000Z') }

describe('restaurantSchema (fatia 3)', () => {
  it('regime é opcional', () => {
    expect(restaurantSchema.safeParse({ name: 'Cantina', audit }).success).toBe(true)
    expect(restaurantSchema.safeParse({ name: 'Cantina', audit, taxRegime: TaxRegime.Mei }).success).toBe(true)
  })

  it('rejeita regime desconhecido', () => {
    expect(restaurantSchema.safeParse({ name: 'Cantina', audit, taxRegime: 'lucroReal' }).success).toBe(false)
  })
})

describe('restaurantUpdateSchema', () => {
  it('aceita nome e regime, ambos opcionais', () => {
    expect(restaurantUpdateSchema.safeParse({}).success).toBe(true)
    expect(restaurantUpdateSchema.safeParse({ taxRegime: TaxRegime.SimplesNacionalAnexoI }).success).toBe(true)
    expect(restaurantUpdateSchema.safeParse({ name: 'Novo nome' }).success).toBe(true)
  })

  it('é estrito: campo desconhecido é rejeitado', () => {
    expect(restaurantUpdateSchema.safeParse({ audit }).success).toBe(false)
  })
})
```

`src/clients/restaurant-client.spec.ts`:

```ts
import { RestaurantClient } from './restaurant-client'
import { TaxRegime } from '../core/data/restaurant/restaurant-schema'

describe('RestaurantClient', () => {
  beforeAll(() => { process.env.BACK_END_URL = 'http://api.test' })
  const headers = { env: 'staging', authorization: 'Bearer t' } as any

  it('me faz GET /me com o mês na query', async () => {
    const client = new RestaurantClient()
    const get = jest.spyOn((client as any).http.connection, 'get').mockResolvedValue({ data: { payload: {} } } as any)

    await client.me({ month: '2026-10' }, headers)

    expect(get).toHaveBeenCalledWith('/me', expect.objectContaining({ params: { month: '2026-10' } }))
  })

  it('updateMe faz PATCH /me com o corpo', async () => {
    const client = new RestaurantClient()
    const patch = jest.spyOn((client as any).http.connection, 'patch').mockResolvedValue({ data: { payload: {} } } as any)

    await client.updateMe({ taxRegime: TaxRegime.Mei }, headers)

    expect(patch).toHaveBeenCalledWith('/me', { taxRegime: TaxRegime.Mei }, expect.anything())
  })

  it('não expõe CRUD genérico (as rotas não existem)', () => {
    const c = new RestaurantClient() as any
    expect(c.insert).toBeUndefined()
    expect(c.findAll).toBeUndefined()
    expect(c.findById).toBeUndefined()
  })
})
```

- [ ] **Passo 2: Ver falhar** — `npx jest src/core/data/restaurant src/clients/restaurant-client.spec.ts` → FAIL (`TaxRegime` não existe).

- [ ] **Passo 3: Schema**

```ts
import { Sapphire } from '@ascendance-hub/sapphire-core'
import { auditSchema } from '../common/audit'

const s = new Sapphire()

/**
 * Regime tributário (M5 / MIN-23). Decide o caminho do cálculo: MEI paga DAS
 * fixo; Simples Nacional Anexo I paga alíquota efetiva sobre a receita.
 * Ausente = "não configurado" (o imposto sai 0 com aviso).
 */
export enum TaxRegime {
  Mei = 'mei',
  SimplesNacionalAnexoI = 'simplesNacionalAnexoI',
}

export const restaurantSchema = s.object({
  name: s.string(),
  taxRegime: s.type().enum(TaxRegime).optional(),
  audit: auditSchema,
})

// Corpo do PATCH /restaurants/me. Objeto estrito: audit e qualquer outro campo
// são rejeitados (mass assignment).
export const restaurantUpdateSchema = s.object({
  name: s.string(),
  taxRegime: s.type().enum(TaxRegime),
}).partial()
```

- [ ] **Passo 4: Tipos do perfil** — `src/core/data/restaurant/restaurant-tax.ts`:

```ts
import type { TaxRegime } from './restaurant-schema'
import type { Restaurant } from './restaurant-entity'

/** Faixa do Anexo I do Simples Nacional (MIN-23). `upTo` inclusivo. */
export interface TaxBracket {
  index: number
  upTo: number
  nominalRate: number
  deduction: number
}

/** Alertas determinísticos da MIN-23 (sem notificação persistida). */
export type TaxInsight =
  | { kind: 'bracketChanged'; severity: 'warning'; fromBracket: number; toBracket: number; fromRate: number; toRate: number; rbt12: number }
  | { kind: 'meiCapNear'; severity: 'warning'; usedPct: number; yearToDateRevenue: number; annualLimit: number }
  | { kind: 'simplesLimitExceeded'; severity: 'warning'; rbt12: number }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

/** Perfil tributário do restaurante num mês. Taxas são frações (0.06728 = 6,728%). */
export interface RestaurantTaxProfile {
  regime: TaxRegime | null
  referenceMonth: string
  rbt12: number
  monthsOfHistory: number
  rbt12Proportional: boolean
  effectiveRate: number | null
  bracket: TaxBracket | null
  previousBracketIndex: number | null
  meiMonthlyDas: number | null
  meiCap: { annualLimit: number; yearToDateRevenue: number; usedPct: number } | null
  insights: TaxInsight[]
}

/** Query de GET /restaurants/me — `month` em `AAAA-MM`, padrão o mês corrente. */
export interface RestaurantProfileQuery {
  month?: string
}

export interface RestaurantProfileResponse {
  restaurant: Restaurant
  tax: RestaurantTaxProfile
}

/** Corpo de PATCH /restaurants/me. */
export interface RestaurantUpdateRequest {
  name?: string
  taxRegime?: TaxRegime
}
```

`src/core/data/restaurant/index.ts`:

```ts
export { Restaurant } from './restaurant-entity'
export { restaurantSchema, restaurantUpdateSchema, TaxRegime } from './restaurant-schema'
export * from './restaurant-tax'
```

- [ ] **Passo 5: Client**

```ts
import { ResponseDto, withHeaders } from '../core'
import { HttpBaseClient } from '../core/client/http-base-client'
import type { Headers } from '../core/data/request/headers'
import type { Restaurant } from '../core/data/restaurant/restaurant-entity'
import type { RestaurantProfileQuery, RestaurantProfileResponse, RestaurantUpdateRequest } from '../core/data/restaurant/restaurant-tax'

/**
 * Restaurante do usuário autenticado (fatia 3). COMPÕE o HttpBaseClient (A10):
 * antes estendia o CRUD genérico de /restaurants, mas essas rotas nunca
 * existiram — todo método dava 404. O restaurante vem do token, por isso `/me`.
 */
export class RestaurantClient {
  private readonly http = new HttpBaseClient<Restaurant>('restaurants')

  /** Restaurante + perfil tributário do mês (padrão: mês corrente). */
  async me (query: RestaurantProfileQuery, headers: Headers): Promise<ResponseDto<RestaurantProfileResponse>> {
    const response = await this.http.connection.get<ResponseDto<RestaurantProfileResponse>>('/me', withHeaders(headers, { params: query }))
    return response.data
  }

  /** Atualiza nome e/ou regime tributário. */
  async updateMe (body: RestaurantUpdateRequest, headers: Headers): Promise<ResponseDto<Restaurant>> {
    const response = await this.http.connection.patch<ResponseDto<Restaurant>>('/me', body, withHeaders(headers))
    return response.data
  }
}
```

- [ ] **Passo 6: Ver passar + checagens + build** — `npx jest && npm run typecheck && npm run lint && npm run build` → verde. Se `client-shape.spec.ts` afirmar métodos de CRUD no `RestaurantClient`, troque a asserção pela do Passo 1.

- [ ] **Passo 7: Commit e push**

```bash
git add src/core/data/restaurant src/clients/restaurant-client.ts src/clients/restaurant-client.spec.ts src/clients/client-shape.spec.ts
git commit -m "feat(restaurante)!: regime tributario, perfil tributario e RestaurantClient /me (M5)" -m "BREAKING CHANGE: RestaurantClient deixa de estender o CRUD generico (as rotas /restaurants nunca existiram) e passa a expor me() e updateMe()." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/20261012/classificacao-contabil
```

---

## Tarefa 3 — MintlyApi: lib local + regra da categoria

**Files:** Create `src/app/financial-category/category-rules.ts`, `src/app/financial-category/category-rules.spec.ts`.

**Interfaces — Produces:**
`SYSTEM_CATEGORY_DRE_GROUPS: Record<string, DreGroup>`;
`resolveInsertDreGroup<T extends { type?: string; dreGroup?: string }>(item: T): T`;
`resolveCategoryUpdate(stored: { type: string; dreGroup?: string }, changes: { type?: string; dreGroup?: string } & Record<string, unknown>): { set: Record<string, unknown>; unsetDreGroup: boolean }`. Erros com `ValidationError` (400, `APP-0005`).

- [ ] **Passo 1: Build local da lib na API**

```bash
cd ../MintlyLib && npm run build && cd ../MintlyApi
rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build
node -e "const l=require('mintly-lib');console.log(l.DreGroup, l.TaxRegime)"
```

Expected: os dois enums impressos. Não commitar.

- [ ] **Passo 2: Testes que falham** — `category-rules.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CategoryType, DreGroup } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'
import { SYSTEM_CATEGORY_DRE_GROUPS, resolveCategoryUpdate, resolveInsertDreGroup } from './category-rules'

describe('resolveInsertDreGroup', () => {
  it('despesa sem grupo recebe opex', () => {
    expect(resolveInsertDreGroup({ name: 'Gás', type: CategoryType.Expense })).toEqual({ name: 'Gás', type: CategoryType.Expense, dreGroup: DreGroup.Opex })
  })

  it('despesa com grupo mantém', () => {
    expect(resolveInsertDreGroup({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }).dreGroup).toBe(DreGroup.Cmv)
  })

  it('receita com grupo é recusada', () => {
    expect(() => resolveInsertDreGroup({ type: CategoryType.Revenue, dreGroup: DreGroup.Opex })).toThrow(ValidationError)
  })

  it('receita sem grupo passa intacta', () => {
    expect(resolveInsertDreGroup({ type: CategoryType.Revenue })).toEqual({ type: CategoryType.Revenue })
  })
})

describe('resolveCategoryUpdate', () => {
  it('despesa: mantém o grupo gravado quando a edição não fala dele', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { name: 'Insumos' }))
      .toEqual({ set: { name: 'Insumos', dreGroup: DreGroup.Cmv }, unsetDreGroup: false })
  })

  it('despesa: troca o grupo quando enviado', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { dreGroup: DreGroup.Labor }).set.dreGroup).toBe(DreGroup.Labor)
  })

  it('despesa sem grupo gravado (antes do backfill): completa com opex', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense }, { name: 'X' }).set.dreGroup).toBe(DreGroup.Opex)
  })

  it('receita → despesa: ganha opex', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Revenue }, { type: CategoryType.Expense }))
      .toEqual({ set: { type: CategoryType.Expense, dreGroup: DreGroup.Opex }, unsetDreGroup: false })
  })

  it('despesa → receita: remove o grupo', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { type: CategoryType.Revenue }))
      .toEqual({ set: { type: CategoryType.Revenue }, unsetDreGroup: true })
  })

  it('receita com grupo enviado é recusada', () => {
    expect(() => resolveCategoryUpdate({ type: CategoryType.Revenue }, { dreGroup: DreGroup.Opex })).toThrow(ValidationError)
    expect(() => resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { type: CategoryType.Revenue, dreGroup: DreGroup.Opex })).toThrow(ValidationError)
  })
})

describe('SYSTEM_CATEGORY_DRE_GROUPS', () => {
  it('mapeia as despesas de sistema do onboarding', () => {
    expect(SYSTEM_CATEGORY_DRE_GROUPS).toEqual({
      'CMV/Insumos': DreGroup.Cmv,
      Salários: DreGroup.Labor,
      Aluguel: DreGroup.Opex,
      Impostos: DreGroup.Tax,
    })
  })
})
```

- [ ] **Passo 3: Ver falhar** — `npx vitest run src/app/financial-category/category-rules.spec.ts` → FAIL (módulo não existe).

- [ ] **Passo 4: Implementar** — `category-rules.ts`:

```ts
import { CategoryType, DreGroup } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'

/**
 * Regras do dreGroup na categoria (M2) — puras, no padrão do `account-rules.ts`.
 * A união da lib impõe "despesa tem grupo, receita não" no documento; aqui mora
 * o que depende do estado gravado (PATCH parcial) e o padrão `opex` no cadastro,
 * que mantém o formulário atual do front funcionando.
 */

/** Grupo das despesas de sistema criadas no onboarding — usado também no backfill. */
export const SYSTEM_CATEGORY_DRE_GROUPS: Record<string, DreGroup> = {
  'CMV/Insumos': DreGroup.Cmv,
  Salários: DreGroup.Labor,
  Aluguel: DreGroup.Opex,
  Impostos: DreGroup.Tax,
}

const REVENUE_WITH_GROUP = 'Categoria de receita não tem dreGroup: a classificação contábil é só de despesa.'

export function resolveInsertDreGroup<T extends { type?: string; dreGroup?: string }> (item: T): T {
  if (item.type === CategoryType.Revenue && item.dreGroup !== undefined) {
    throw new ValidationError(REVENUE_WITH_GROUP)
  }
  if (item.type === CategoryType.Expense) {
    return { ...item, dreGroup: item.dreGroup ?? DreGroup.Opex }
  }
  return item
}

export function resolveCategoryUpdate (
  stored: { type: string; dreGroup?: string },
  changes: { type?: string; dreGroup?: string } & Record<string, unknown>,
): { set: Record<string, unknown>; unsetDreGroup: boolean } {
  const finalType = changes.type ?? stored.type

  if (finalType === CategoryType.Revenue) {
    if (changes.dreGroup !== undefined) throw new ValidationError(REVENUE_WITH_GROUP)
    return { set: { ...changes }, unsetDreGroup: stored.dreGroup !== undefined }
  }

  return {
    set: { ...changes, dreGroup: changes.dreGroup ?? stored.dreGroup ?? DreGroup.Opex },
    unsetDreGroup: false,
  }
}
```

- [ ] **Passo 5: Ver passar** — mesmo comando → PASS.

- [ ] **Passo 6: Commit** — `git add src/app/financial-category/category-rules.ts src/app/financial-category/category-rules.spec.ts && git commit -m "feat(categoria): regra pura do dreGroup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 4 — MintlyApi: categoria pela API e onboarding

**Files:** Modify `financial-category-controller.ts`, `financial-category-repository.ts`, `src/app/auth/use-cases/register-use-case.ts`; Test `src/app/financial-category/dre-group.int.spec.ts` (novo).

**Interfaces — Consumes:** Tarefa 3. **Produces:** `FinancialCategoryRepository.updateCategory(id: string, set: Record<string, unknown>, unsetDreGroup: boolean, ctx: RequestContext): Promise<FinancialCategory>`.

- [ ] **Passo 1: Testes de integração que falham** — `dre-group.int.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

let envCounter = 0
const freshEnv = () => `int_dre_${++envCounter}`

describe('dreGroup na categoria (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance

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

  async function setup () {
    const env = freshEnv()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: 'Dono DRE', phone: '11977777777' }, password: 'Senha123', restaurantName: 'Rest DRE', termsAccepted: true, email: `dre_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { env, auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string, db: mongoConnection.getDatabase(env) }
  }

  const base = { behavior: 'fixed', operationalNature: 'operational', status: 'active' }
  const create = (auth: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/financial-categories', headers: auth, payload: { ...base, ...payload } })
  const patch = (auth: Record<string, string>, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/financial-categories/${id}`, headers: auth, payload })
  const stored = (db: any, id: string) => db.collection('financial_categories').findOne({ _id: new ObjectId(id) })

  it('onboarding cria as despesas de sistema com o grupo certo', async () => {
    const s = await setup()
    const docs = await s.db.collection('financial_categories').find({ restaurantId: s.restaurantId, type: 'expense' }).toArray()
    expect(Object.fromEntries(docs.map((d: any) => [d.name, d.dreGroup]))).toEqual({
      'CMV/Insumos': 'cmv', Salários: 'labor', Aluguel: 'opex', Impostos: 'tax',
    })
    const revenue = await s.db.collection('financial_categories').find({ restaurantId: s.restaurantId, type: 'revenue' }).toArray()
    expect(revenue.every((d: any) => d.dreGroup === undefined)).toBe(true)
  })

  it('cadastro de despesa sem grupo vira opex; com grupo mantém; mixed é aceito', async () => {
    const s = await setup()
    const a = await create(s.auth, { name: 'Gás', type: 'expense' })
    const b = await create(s.auth, { name: 'Pró-labore', type: 'expense', dreGroup: 'labor', behavior: 'mixed' })
    expect(a.statusCode).toBe(201)
    expect((await stored(s.db, a.json().payload._id)).dreGroup).toBe('opex')
    expect(await stored(s.db, b.json().payload._id)).toMatchObject({ dreGroup: 'labor', behavior: 'mixed' })
  })

  it('cadastro de receita com grupo → 400', async () => {
    const s = await setup()
    const res = await create(s.auth, { name: 'Venda extra', type: 'revenue', dreGroup: 'opex' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('APP-0005')
  })

  it('edição troca o grupo e preserva o resto', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Embalagens', type: 'expense' })).json().payload._id
    const res = await patch(s.auth, id, { dreGroup: 'cmv' })
    expect(res.statusCode).toBe(200)
    expect(await stored(s.db, id)).toMatchObject({ name: 'Embalagens', dreGroup: 'cmv' })
  })

  it('despesa → receita remove o grupo; receita → despesa ganha opex', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Ambígua', type: 'expense', dreGroup: 'cmv' })).json().payload._id

    expect((await patch(s.auth, id, { type: 'revenue' })).statusCode).toBe(200)
    expect((await stored(s.db, id)).dreGroup).toBeUndefined()

    expect((await patch(s.auth, id, { type: 'expense' })).statusCode).toBe(200)
    expect((await stored(s.db, id)).dreGroup).toBe('opex')
  })

  it('edição de receita mandando grupo → 400', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Venda evento', type: 'revenue' })).json().payload._id
    expect((await patch(s.auth, id, { dreGroup: 'opex' })).statusCode).toBe(400)
  })

  it('despesa antiga sem grupo (antes do backfill) pode ser editada e ganha opex', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Legada', type: 'expense' })).json().payload._id
    await s.db.collection('financial_categories').updateOne({ _id: new ObjectId(id) }, { $unset: { dreGroup: '' } })

    const res = await patch(s.auth, id, { name: 'Legada 2' })

    expect(res.statusCode).toBe(200)
    expect(await stored(s.db, id)).toMatchObject({ name: 'Legada 2', dreGroup: 'opex' })
  })
})
```

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/financial-category/dre-group.int.spec.ts` → FAIL (onboarding sem grupo; cadastro sem `opex`; troca de tipo não remove).

- [ ] **Passo 3: Onboarding** — em `register-use-case.ts`, importe `SYSTEM_CATEGORY_DRE_GROUPS` de `'../../financial-category/category-rules'` e no `categoryDocs` acrescente o grupo só às despesas:

```ts
        const categoryDocs = DEFAULT_CATEGORIES.map(cat => ({
          restaurantId,
          name: cat.name,
          type: cat.type,
          behavior: cat.behavior,
          operationalNature: cat.operationalNature,
          // Fatia 3 (M2): despesa de sistema nasce classificada para o DRE.
          ...(cat.type === CategoryType.Expense ? { dreGroup: SYSTEM_CATEGORY_DRE_GROUPS[cat.name] } : {}),
          status: RecordStatus.Active,
          isSystem: true,
          usage: 0,
          history: [],
          audit,
        }))
```

- [ ] **Passo 4: Repositório** — em `financial-category-repository.ts`:

```ts
  /**
   * PATCH de categoria com a regra do dreGroup (fatia 3): `$set` das mudanças e,
   * quando a categoria vira receita, `$unset` do grupo — o update genérico só
   * sabe fazer `$set`. Escopado por restaurantId.
   */
  async updateCategory (id: string, set: Record<string, unknown>, unsetDreGroup: boolean, ctx: RequestContext): Promise<FinancialCategory> {
    if (!ObjectId.isValid(id)) throw new NotFoundError(Resource.FinancialCategory, id)
    const update: Record<string, unknown> = { $set: set }
    if (unsetDreGroup) update.$unset = { dreGroup: '' }

    const result = await this.getCollection(ctx).findOneAndUpdate(
      { _id: new ObjectId(id), restaurantId: ctx.restaurantId } as any,
      update,
      { returnDocument: 'after' },
    )
    if (!result) throw new NotFoundError(Resource.FinancialCategory, id)
    return result as unknown as FinancialCategory
  }
```

(imports: `ObjectId` de `mongodb`, `NotFoundError`, `Resource`.)

- [ ] **Passo 5: Controller** — em `financial-category-controller.ts` importe `financialCategorySchema`, `resolveInsertDreGroup` e `resolveCategoryUpdate`, acrescente:

```ts
  /** Cadastro: despesa sem grupo recebe `opex`; receita com grupo → 400. */
  async insert (item: FinancialCategory, source?: ContextSource): Promise<ResponseStructure> {
    return super.insert(resolveInsertDreGroup(item as any), source)
  }
```

e troque o `return super.update(id, item, source)` do `update` por:

```ts
    const parsed = financialCategoryUpdateSchema.parse(item) as Record<string, unknown>
    const { set, unsetDreGroup } = resolveCategoryUpdate(current as any, parsed)

    // Coerência tipo × grupo do documento RESULTANTE pela união da lib — o mesmo
    // contrato que o cadastro respeita.
    const { _id, ...stored } = current as any
    const resulting = { ...stored, ...set }
    if (unsetDreGroup) delete resulting.dreGroup
    financialCategorySchema.parse(resulting)

    const result = await this.repo.updateCategory(id, set, unsetDreGroup, ctx)
    return new ResponseBuilder().payload(result).build()
```

- [ ] **Passo 6: Ver passar** — `npx vitest run src/app/financial-category` → PASS. Se algum teste antigo de categoria de despesa falhar porque a fixture planta despesa **sem** `dreGroup` direto no banco e edita, isso é o caso coberto pelo último teste do Passo 1 e deve passar; se falhar na validação pela união por campo legado, pare e registre (Review Focus 1).

- [ ] **Passo 7: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 8: Commit** — `git add src/app/financial-category src/app/auth/use-cases/register-use-case.ts && git commit -m "feat(categoria): dreGroup no cadastro, na edicao e no onboarding" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 5 — Regra tributária: faixas, alíquota e `saleTax`

**Files:** Create `src/app/tax/tax-rules.ts`, `src/app/tax/tax-rules.spec.ts`.

**Interfaces — Produces:** `SIMPLES_ANEXO_I: readonly TaxBracket[]`, `SIMPLES_LIMIT`, `MEI_ANNUAL_LIMIT`, `MEI_MONTHLY_LIMIT`, `MEI_CAP_WARNING_PCT`; `bracketFor(rbt12: number): TaxBracket`; `effectiveRate(rbt12: number): number`; `saleTax(value: number, regime: TaxRegime, p: { rbt12: number; meiMonthlyDas: number | null }): SaleTax` com `type SaleTax = { kind: 'fixed'; monthlyDas: number | null } | { kind: 'variable'; effectiveRate: number; tax: number }`.

- [ ] **Passo 1: Testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { TaxRegime } from 'mintly-lib'
import { SIMPLES_ANEXO_I, bracketFor, effectiveRate, saleTax } from './tax-rules'

describe('bracketFor — Anexo I, limites inclusivos', () => {
  it('180.000,00 é faixa 1; 180.000,01 é faixa 2', () => {
    expect(bracketFor(180000).index).toBe(1)
    expect(bracketFor(180000.01).index).toBe(2)
  })

  it('cada limite superior pertence à própria faixa', () => {
    for (const b of SIMPLES_ANEXO_I) expect(bracketFor(b.upTo).index).toBe(b.index)
  })

  it('acima de 4,8 mi fica na faixa 6', () => {
    expect(bracketFor(5_000_000).index).toBe(6)
  })
})

describe('effectiveRate — (RBT12 × nominal − dedução) / RBT12', () => {
  it.each([
    [100_000, 0.04],
    [300_000, (300_000 * 0.073 - 5_940) / 300_000],
    [500_000, (500_000 * 0.095 - 13_860) / 500_000],
    [1_000_000, (1_000_000 * 0.107 - 22_500) / 1_000_000],
    [2_000_000, (2_000_000 * 0.143 - 87_300) / 2_000_000],
    [4_000_000, (4_000_000 * 0.19 - 378_000) / 4_000_000],
  ])('RBT12 %d', (rbt12, expected) => {
    expect(effectiveRate(rbt12)).toBeCloseTo(expected, 10)
  })

  it('RBT12 500.000 → 6,728%', () => {
    expect(effectiveRate(500_000)).toBeCloseTo(0.06728, 10)
  })

  it('RBT12 zero: nominal da faixa 1, sem dividir por zero', () => {
    expect(effectiveRate(0)).toBe(0.04)
  })
})

describe('saleTax', () => {
  it('Simples: alíquota efetiva × valor, em centavos', () => {
    expect(saleTax(1234.56, TaxRegime.SimplesNacionalAnexoI, { rbt12: 500_000, meiMonthlyDas: null }))
      .toEqual({ kind: 'variable', effectiveRate: effectiveRate(500_000), tax: 83.06 })
  })

  it('MEI: DAS fixo do mês (ou null sem configuração)', () => {
    expect(saleTax(1000, TaxRegime.Mei, { rbt12: 0, meiMonthlyDas: 81.05 })).toEqual({ kind: 'fixed', monthlyDas: 81.05 })
    expect(saleTax(1000, TaxRegime.Mei, { rbt12: 0, meiMonthlyDas: null })).toEqual({ kind: 'fixed', monthlyDas: null })
  })
})
```

(1234,56 × 0,06728 = 83,0612… → 83,06.)

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/tax/tax-rules.spec.ts` → FAIL (módulo não existe).

- [ ] **Passo 3: Implementar**

```ts
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
```

- [ ] **Passo 4: Ver passar** — mesmo comando → PASS.

- [ ] **Passo 5: Commit** — `git add src/app/tax && git commit -m "feat(tax): Anexo I, aliquota efetiva e saleTax (MIN-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

**Nota:** a spec escreve `saleTax(value, regime, rbt12)`; aqui o terceiro argumento é `{ rbt12, meiMonthlyDas }` porque o MEI precisa do DAS do mês. Mesmo contrato de saída.

---

## Tarefa 6 — Regra tributária: meses, RBT12, teto do MEI, insights e perfil

**Files:** Modify `src/app/reports/shared/period.ts` (+ spec); Modify `src/app/tax/tax-rules.ts` (+ spec).

**Interfaces — Produces:** em `period.ts`: `toLocalMonth(instant: Date): string`, `addMonths(month: string, n: number): string`, `diffMonths(from: string, to: string): number`, `startOfLocalMonth(month: string): Date`. Em `tax-rules.ts`: `computeRbt12(p: { referenceMonth: string; firstMonth: string | null; revenueByMonth: Map<string, number> }): { rbt12: number; monthsOfHistory: number; proportional: boolean }`; `meiCap(p: { referenceMonth: string; firstMonth: string | null; revenueByMonth: Map<string, number> }): { annualLimit: number; yearToDateRevenue: number; usedPct: number }`; `buildTaxProfile(p: { regime: TaxRegime | null; referenceMonth: string; firstMonth: string | null; revenueByMonth: Map<string, number>; meiMonthlyDas: number | null }): RestaurantTaxProfile`.

- [ ] **Passo 1: Testes de mês que falham** — em `period.spec.ts` (acrescente os nomes ao import):

```ts
describe('meses em America/Sao_Paulo', () => {
  it('22h do dia 31 em São Paulo ainda é aquele mês', () => {
    expect(toLocalMonth(new Date('2026-11-01T01:00:00.000Z'))).toBe('2026-10')
  })

  it('soma e diferença de meses atravessando o ano', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(diffMonths('2025-10', '2026-10')).toBe(12)
  })

  it('início do mês local', () => {
    expect(startOfLocalMonth('2026-10').toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })
})
```

- [ ] **Passo 2: Ver falhar e implementar** — `npx vitest run src/app/reports/shared/period.spec.ts` → FAIL; acrescente a `period.ts`:

```ts
/** Mês civil local (`AAAA-MM`) de um instante — o mês da competência. */
export function toLocalMonth (instant: Date): string {
  return toLocalDay(instant).slice(0, 7)
}

export function addMonths (month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

export function diffMonths (from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty * 12 + tm) - (fy * 12 + fm)
}

/** Primeiro instante do mês local — limite de filtro no Mongo. */
export function startOfLocalMonth (month: string): Date {
  return startOfLocalDay(`${month}-01`)
}
```

Rode de novo → PASS. Commit: `git add src/app/reports/shared && git commit -m "feat(reports): meses locais em America/Sao_Paulo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

- [ ] **Passo 3: Testes tributários que falham** — em `tax-rules.spec.ts` (acrescente `buildTaxProfile, computeRbt12, meiCap` ao import):

```ts
const rev = (entries: Array<[string, number]>) => new Map(entries)

describe('computeRbt12', () => {
  it('12 meses ou mais: soma dos 12 anteriores', () => {
    const months = Array.from({ length: 13 }, (_, i) => [`2025-${String(i + 1).padStart(2, '0')}`, 10_000] as [string, number])
    const r = computeRbt12({ referenceMonth: '2026-02', firstMonth: '2025-01', revenueByMonth: rev([...months.slice(0, 12), ['2026-01', 20_000]]) })
    expect(r).toEqual({ rbt12: 11 * 10_000 + 20_000, monthsOfHistory: 13, proportional: false })
  })

  it('primeiro mês de atividade: receita do mês × 12', () => {
    expect(computeRbt12({ referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 5_000]]) }))
      .toEqual({ rbt12: 60_000, monthsOfHistory: 0, proportional: true })
  })

  it('1 a 11 meses: média dos meses anteriores × 12', () => {
    expect(computeRbt12({ referenceMonth: '2026-10', firstMonth: '2026-07', revenueByMonth: rev([['2026-07', 9_000], ['2026-08', 12_000], ['2026-09', 15_000], ['2026-10', 99_999]]) }))
      .toEqual({ rbt12: 144_000, monthsOfHistory: 3, proportional: true })
  })

  it('sem nenhuma movimentação: zero', () => {
    expect(computeRbt12({ referenceMonth: '2026-10', firstMonth: null, revenueByMonth: rev([]) }))
      .toEqual({ rbt12: 0, monthsOfHistory: 0, proportional: true })
  })
})

describe('meiCap', () => {
  it('teto cheio quando começou em ano anterior; acumulado de janeiro até o mês', () => {
    expect(meiCap({ referenceMonth: '2026-03', firstMonth: '2025-05', revenueByMonth: rev([['2025-12', 9_999], ['2026-01', 10_000], ['2026-02', 20_000], ['2026-03', 30_000]]) }))
      .toEqual({ annualLimit: 81_000, yearToDateRevenue: 60_000, usedPct: 60_000 / 81_000 })
  })

  it('ano de início: teto proporcional (6.750 × meses ativos)', () => {
    expect(meiCap({ referenceMonth: '2026-10', firstMonth: '2026-09', revenueByMonth: rev([['2026-09', 5_000], ['2026-10', 5_000]]) }))
      .toEqual({ annualLimit: 13_500, yearToDateRevenue: 10_000, usedPct: 10_000 / 13_500 })
  })
})

describe('buildTaxProfile', () => {
  const twelveFlat = (value: number, last: number) => {
    const entries: Array<[string, number]> = []
    for (let i = 13; i >= 2; i--) entries.push([addMonths('2026-10', -i), value])
    entries.push([addMonths('2026-10', -1), last])
    return rev(entries)
  }

  it('sem regime: só o RBT12 e o aviso de não configurado', () => {
    const p = buildTaxProfile({ regime: null, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 1_000]]), meiMonthlyDas: null })
    expect(p).toEqual({
      regime: null, referenceMonth: '2026-10', rbt12: 12_000, monthsOfHistory: 0, rbt12Proportional: true,
      effectiveRate: null, bracket: null, previousBracketIndex: null, meiMonthlyDas: null, meiCap: null,
      insights: [{ kind: 'taxRegimeNotConfigured', severity: 'info' }],
    })
  })

  it('Simples cruzando da faixa 2 para a 3: bracketChanged', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2025-09', revenueByMonth: twelveFlat(29_000, 45_000), meiMonthlyDas: null })
    expect(p).toMatchObject({ rbt12: 364_000, monthsOfHistory: 13, rbt12Proportional: false, bracket: { index: 3 }, previousBracketIndex: 2 })
    expect(p.effectiveRate).toBeCloseTo(20_720 / 364_000, 10)
    expect(p.insights).toEqual([{
      kind: 'bracketChanged', severity: 'warning', fromBracket: 2, toBracket: 3,
      fromRate: effectiveRate(348_000), toRate: effectiveRate(364_000), rbt12: 364_000,
    }])
  })

  it('Simples sem troca de faixa: sem insight', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2025-09', revenueByMonth: twelveFlat(10_000, 10_000), meiMonthlyDas: null })
    expect(p.insights).toEqual([])
    expect(p.previousBracketIndex).toBe(1)
  })

  it('Simples no primeiro mês: sem faixa anterior', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([]), meiMonthlyDas: null })
    expect(p).toMatchObject({ rbt12: 0, effectiveRate: 0.04, bracket: { index: 1 }, previousBracketIndex: null, insights: [] })
  })

  it('Simples acima de 4,8 mi: simplesLimitExceeded', () => {
    const p = buildTaxProfile({ regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: '2026-10', firstMonth: '2025-01', revenueByMonth: twelveFlat(410_000, 410_000), meiMonthlyDas: null })
    expect(p.insights).toContainEqual({ kind: 'simplesLimitExceeded', severity: 'warning', rbt12: 4_920_000 })
  })

  it('MEI: DAS do mês, teto e meiCapNear a partir de 80%', () => {
    const near = buildTaxProfile({ regime: TaxRegime.Mei, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 5_400]]), meiMonthlyDas: 81.05 })
    expect(near).toMatchObject({ meiMonthlyDas: 81.05, effectiveRate: null, bracket: null, meiCap: { annualLimit: 6_750, yearToDateRevenue: 5_400, usedPct: 0.8 } })
    expect(near.insights).toEqual([{ kind: 'meiCapNear', severity: 'warning', usedPct: 0.8, yearToDateRevenue: 5_400, annualLimit: 6_750 }])

    const below = buildTaxProfile({ regime: TaxRegime.Mei, referenceMonth: '2026-10', firstMonth: '2026-10', revenueByMonth: rev([['2026-10', 5_393.25]]), meiMonthlyDas: null })
    expect(below.insights).toEqual([])
  })
})
```

(5.393,25 / 6.750 = 0,799 — 79,9%.)

- [ ] **Passo 4: Ver falhar** — `npx vitest run src/app/tax/tax-rules.spec.ts` → FAIL (`computeRbt12` não existe).

- [ ] **Passo 5: Implementar** — acrescente a `tax-rules.ts` (imports: `RestaurantTaxProfile, TaxInsight` de `mintly-lib`; `addMonths, diffMonths` de `'../reports/shared/period'`):

```ts
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
 * Teto do MEI no ano do mês de referência: R$ 81.000, ou R$ 6.750 × meses
 * ativos no ano de início. `usedPct` = receita de janeiro até o mês ÷ teto.
 */
export function meiCap (p: { referenceMonth: string; firstMonth: string | null; revenueByMonth: Map<string, number> }) {
  const year = p.referenceMonth.slice(0, 4)
  let ytd = 0
  for (let m = `${year}-01`; m <= p.referenceMonth; m = addMonths(m, 1)) ytd += cents(p.revenueByMonth.get(m) ?? 0)

  const startedThisYear = p.firstMonth != null && p.firstMonth.slice(0, 4) === year
  const annualLimit = startedThisYear
    ? MEI_MONTHLY_LIMIT * (diffMonths(p.firstMonth!, p.referenceMonth) + 1)
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
```

- [ ] **Passo 6: Ver passar + cobertura** — `npx vitest run src/app/tax src/app/reports/shared --coverage --coverage.include='src/app/tax/**' --coverage.include='src/app/reports/shared/**'` → PASS, 100% de branches em `tax-rules.ts` (escreva o teste que faltar; não exclua).

- [ ] **Passo 7: Commit** — `git add src/app/tax && git commit -m "feat(tax): RBT12 proporcional, teto do MEI, insights e perfil tributario (MIN-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 7 — Repositórios e query do perfil

**Files:** Create `src/app/tax/tax-repository.ts`, `src/app/tax/tax-settings-repository.ts`, `src/app/tax/tax-profile.query.ts`, `src/app/tax/tax-scenario.ts`, `src/app/tax/tax-profile.int.spec.ts`.

**Interfaces — Produces:** `TaxRepository.revenueByMonth(ctx, { from: string; to: string }): Promise<Map<string, number>>` (meses inclusivos) e `.firstMovementMonth(ctx): Promise<string | null>`; `TaxSettingsRepository.meiMonthlyDasAt(month: string): Promise<number | null>`; `TaxProfileQuery.execute(ctx, { regime: TaxRegime | null; referenceMonth: string }): Promise<RestaurantTaxProfile>`; `TAX_SETTINGS_COLLECTION = 'tax_settings'`; `taxScenarioMovements(referenceMonth, refs)` e `TAX_SCENARIO_EXPECTED`.

- [ ] **Passo 1: Cenário** — `tax-scenario.ts`:

```ts
import { toDecimal128 } from '../../core/money/money'
import { addMonths, startOfLocalMonth } from '../reports/shared/period'

/**
 * Cenário tributário determinístico, relativo ao mês de referência M. Uma
 * entrada por mês, no dia 1 ao meio-dia local (nunca no futuro):
 *   M-13 … M-2: R$ 29.000 cada (12 meses) → RBT12(M-1) = 348.000 (faixa 2)
 *   M-1:        R$ 45.000                 → RBT12(M)   = 11 × 29.000 + 45.000 = 364.000 (faixa 3)
 *   M:          R$ 30.000                 (não entra no RBT12 de M)
 * Alíquota de M = (364.000 × 9,5% − 13.860) / 364.000 = 20.720 / 364.000.
 * Usado pelo teste de integração e por `SEED_SCENARIO=tax npm run db:seed-demo`.
 */
export const TAX_SEED_MARKER = 'seed-demo:tax'

export interface TaxScenarioRefs {
  restaurantId: string
  account: { _id: string; name: string; type: string }
  revenueCategory: { _id: string; name: string }
}

const MONTHLY: Array<[number, number]> = [
  ...Array.from({ length: 12 }, (_, i) => [-(13 - i), 29_000] as [number, number]),
  [-1, 45_000],
  [0, 30_000],
]

export function taxScenarioMovements (referenceMonth: string, refs: TaxScenarioRefs): Record<string, unknown>[] {
  return MONTHLY.map(([offset, value]) => {
    const month = addMonths(referenceMonth, offset)
    const money = toDecimal128(value)
    return {
      restaurantId: refs.restaurantId,
      title: `Vendas ${month}`,
      direction: 'in',
      status: 'settled',
      statusSource: 'auto',
      date: new Date(startOfLocalMonth(month).getTime() + 12 * 60 * 60 * 1000),
      grossValue: money,
      feeValue: toDecimal128(0),
      netValue: money,
      account: refs.account,
      category: { ...refs.revenueCategory, type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      description: TAX_SEED_MARKER,
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
    }
  })
}

/** O que o perfil Simples TEM que mostrar para o cenário acima. */
export const TAX_SCENARIO_EXPECTED = {
  rbt12: 364_000,
  monthsOfHistory: 13,
  rbt12Proportional: false,
  bracketIndex: 3,
  previousBracketIndex: 2,
  effectiveRate: 20_720 / 364_000,
  previousRate: 19_464 / 348_000,
}
```

- [ ] **Passo 2: Testes de integração que falham** — `tax-profile.int.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { TaxRegime } from 'mintly-lib'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { APP_DB } from '../environment/env-allowlist'
import { toDecimal128 } from '../../core/money/money'
import { toLocalMonth, startOfLocalMonth, addMonths } from '../reports/shared/period'
import { TaxProfileQuery } from './tax-profile.query'
import { TAX_SETTINGS_COLLECTION } from './tax-settings-repository'
import { TAX_SCENARIO_EXPECTED, taxScenarioMovements } from './tax-scenario'

const ENV = 'int_tax_profile'
const refs = (restaurantId: string) => ({ restaurantId, account: { _id: 'acc', name: 'Caixa', type: 'cash' }, revenueCategory: { _id: 'cat', name: 'Vendas' } })

describe('TaxProfileQuery (Integration)', () => {
  let replset: MongoMemoryReplSet
  const query = new TaxProfileQuery()
  const month = toLocalMonth(new Date())

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
  })

  afterAll(async () => {
    await mongoConnection.disconnect()
    await replset.stop()
  })

  const movements = () => mongoConnection.getDatabase(ENV).collection('financial_movements')

  it('Simples: confere o cenário (RBT12, faixa e troca de faixa)', async () => {
    await movements().insertMany(taxScenarioMovements(month, refs('r-simples')))

    const p = await query.execute({ env: ENV, restaurantId: 'r-simples' }, { regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: month })

    expect(p).toMatchObject({
      rbt12: TAX_SCENARIO_EXPECTED.rbt12,
      monthsOfHistory: TAX_SCENARIO_EXPECTED.monthsOfHistory,
      rbt12Proportional: false,
      bracket: { index: TAX_SCENARIO_EXPECTED.bracketIndex },
      previousBracketIndex: TAX_SCENARIO_EXPECTED.previousBracketIndex,
    })
    expect(p.effectiveRate).toBeCloseTo(TAX_SCENARIO_EXPECTED.effectiveRate, 10)
    expect(p.insights[0]).toMatchObject({ kind: 'bracketChanged', fromBracket: 2, toBracket: 3 })
  })

  it('ignora saídas, canceladas e outro restaurante', async () => {
    const base = { title: 'x', statusSource: 'auto', feeValue: toDecimal128(0), account: refs('x').account, paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: new Date(), updatedAt: new Date() } }
    const date = new Date(startOfLocalMonth(month).getTime() + 12 * 3600_000)
    await movements().insertMany([
      { ...base, restaurantId: 'r-filtros', direction: 'in', status: 'settled', date, grossValue: toDecimal128(1000), netValue: toDecimal128(1000), category: { _id: 'c', name: 'V', type: 'revenue' } },
      { ...base, restaurantId: 'r-filtros', direction: 'out', status: 'settled', date, grossValue: toDecimal128(9999), netValue: toDecimal128(9999), category: { _id: 'c', name: 'D', type: 'expense' } },
      { ...base, restaurantId: 'r-filtros', direction: 'in', status: 'cancelled', date, grossValue: toDecimal128(9999), netValue: toDecimal128(9999), category: { _id: 'c', name: 'V', type: 'revenue' } },
      { ...base, restaurantId: 'r-outro', direction: 'in', status: 'settled', date, grossValue: toDecimal128(9999), netValue: toDecimal128(9999), category: { _id: 'c', name: 'V', type: 'revenue' } },
    ])

    const p = await query.execute({ env: ENV, restaurantId: 'r-filtros' }, { regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: month })

    expect(p).toMatchObject({ rbt12: 12_000, monthsOfHistory: 0, rbt12Proportional: true })
  })

  it('receita às 22h do último dia do mês anterior conta naquele mês', async () => {
    const lastMonthEnd = new Date(startOfLocalMonth(month).getTime() - 2 * 3600_000) // 22h local do último dia de M-1
    await movements().insertOne({
      restaurantId: 'r-fuso', title: 'Noite', direction: 'in', status: 'settled', statusSource: 'auto', date: lastMonthEnd,
      grossValue: toDecimal128(2_000), feeValue: toDecimal128(0), netValue: toDecimal128(2_000),
      account: refs('x').account, category: { _id: 'c', name: 'V', type: 'revenue' }, paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const p = await query.execute({ env: ENV, restaurantId: 'r-fuso' }, { regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: month })

    // primeiro mês = M-1; 1 mês de histórico; RBT12 = 2.000 × 12
    expect(p).toMatchObject({ monthsOfHistory: 1, rbt12: 24_000, rbt12Proportional: true })
  })

  it('MEI: DAS vigente pelo validFrom; sem DAS semeado, null', async () => {
    const settings = mongoConnection.getDatabase(APP_DB).collection(TAX_SETTINGS_COLLECTION)

    const none = await query.execute({ env: ENV, restaurantId: 'r-mei' }, { regime: TaxRegime.Mei, referenceMonth: month })
    expect(none.meiMonthlyDas).toBeNull()

    await settings.insertMany([
      { validFrom: '2000-01', meiMonthlyDas: 50 },
      { validFrom: addMonths(month, -1), meiMonthlyDas: 80 },
      { validFrom: addMonths(month, 1), meiMonthlyDas: 99 },
    ])
    const p = await query.execute({ env: ENV, restaurantId: 'r-mei' }, { regime: TaxRegime.Mei, referenceMonth: month })
    expect(p.meiMonthlyDas).toBe(80)
  })
})
```

- [ ] **Passo 3: Ver falhar** — `npx vitest run src/app/tax/tax-profile.int.spec.ts` → FAIL (módulos não existem).

- [ ] **Passo 4: Repositórios e query**

`tax-repository.ts`:

```ts
import { MovementDirection, MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { decimalToNumber } from '../../core/money/money'
import { REPORT_TIME_ZONE, addMonths, startOfLocalMonth, toLocalMonth } from '../reports/shared/period'

/**
 * Receita por competência para o RBT12 (MIN-23, sem `daily_sales`): Σ grossValue
 * das ENTRADAS não canceladas, agrupada por mês civil em São Paulo. Pendentes
 * contam — faturamento é competência. Escopado por restaurantId.
 */
export class TaxRepository {
  private movements (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection('financial_movements')
  }

  /** Receita de cada mês em [from, to] (inclusivo). Mês sem receita não aparece. */
  async revenueByMonth (ctx: RequestContext, w: { from: string; to: string }): Promise<Map<string, number>> {
    const rows = await this.movements(ctx).aggregate([
      {
        $match: {
          restaurantId: ctx.restaurantId,
          direction: MovementDirection.In,
          status: { $ne: MovementStatus.Cancelled },
          date: { $gte: startOfLocalMonth(w.from), $lt: startOfLocalMonth(addMonths(w.to, 1)) },
        },
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: REPORT_TIME_ZONE } }, total: { $sum: '$grossValue' } } },
    ]).toArray()
    return new Map(rows.map((r) => [String(r._id), decimalToNumber(r.total)]))
  }

  /** Mês da primeira movimentação não cancelada do restaurante (qualquer direção). */
  async firstMovementMonth (ctx: RequestContext): Promise<string | null> {
    const first = await this.movements(ctx)
      .find({ restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled } }, { projection: { date: 1 } })
      .sort({ date: 1 })
      .limit(1)
      .next()
    return first?.date ? toLocalMonth(first.date) : null
  }
}
```

`tax-settings-repository.ts`:

```ts
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../environment/env-allowlist'

/** Configuração tributária global, no banco `app` (um por cluster). */
export const TAX_SETTINGS_COLLECTION = 'tax_settings'

/**
 * DAS do MEI vigente num mês: o documento com o maior `validFrom` (`AAAA-MM`,
 * comparável como string) até o mês. Semeado por `npm run db:seed-tax-settings`
 * — o valor muda todo ano e nunca fica no código (MIN-23).
 */
export class TaxSettingsRepository {
  async meiMonthlyDasAt (month: string): Promise<number | null> {
    const doc = await MongoDBConnection.getInstance().getDatabase(APP_DB).collection(TAX_SETTINGS_COLLECTION)
      .find({ validFrom: { $lte: month } })
      .sort({ validFrom: -1 })
      .limit(1)
      .next()
    return doc?.meiMonthlyDas ?? null
  }
}
```

`tax-profile.query.ts`:

```ts
import { RestaurantTaxProfile, TaxRegime } from 'mintly-lib'
import { RequestContext } from '../../core/context/request-context'
import { addMonths } from '../reports/shared/period'
import { buildTaxProfile } from './tax-rules'
import { TaxRepository } from './tax-repository'
import { TaxSettingsRepository } from './tax-settings-repository'

/**
 * Perfil tributário de um mês. Uma consulta de receita (M-13 até M) serve o
 * RBT12 de M, o de M-1 (faixa anterior) e o acumulado do ano (teto do MEI). A
 * fatia 4 (DRE) reaproveita esta query.
 */
export class TaxProfileQuery {
  constructor (
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly settingsRepo: TaxSettingsRepository = new TaxSettingsRepository(),
  ) {}

  async execute (ctx: RequestContext, p: { regime: TaxRegime | null; referenceMonth: string }): Promise<RestaurantTaxProfile> {
    const [firstMonth, revenueByMonth, meiMonthlyDas] = await Promise.all([
      this.taxRepo.firstMovementMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(p.referenceMonth, -13), to: p.referenceMonth }),
      p.regime === TaxRegime.Mei ? this.settingsRepo.meiMonthlyDasAt(p.referenceMonth) : Promise.resolve(null),
    ])
    return buildTaxProfile({ regime: p.regime, referenceMonth: p.referenceMonth, firstMonth, revenueByMonth, meiMonthlyDas })
  }
}
```

- [ ] **Passo 5: Ver passar** — `npx vitest run src/app/tax` → PASS.

- [ ] **Passo 6: Commit** — `git add src/app/tax && git commit -m "feat(tax): receita por competencia, DAS vigente e query do perfil tributario" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 8 — Rotas `/restaurants/me`

**Files:** Create `src/app/restaurant/restaurant-repository.ts`, `src/app/restaurant/reference-month.ts` (+ spec), `src/app/restaurant/use-cases/get-restaurant-profile.query.ts`, `src/app/restaurant/use-cases/update-restaurant.use-case.ts`, `src/app/restaurant/restaurant-controller.ts`, `src/app/restaurant/restaurant-routes.ts`, `src/app/restaurant/restaurant.int.spec.ts`; Modify `src/infrastructure/server/build-server.ts`.

**Interfaces — Consumes:** `TaxProfileQuery` (Tarefa 7), `restaurantUpdateSchema` (lib). **Produces:** `parseReferenceMonth(value: string | undefined, now: Date): string`; `GET /restaurants/me`, `PATCH /restaurants/me`.

- [ ] **Passo 1: Teste unitário que falha** — `reference-month.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../core/errors/core/validation-error'
import { parseReferenceMonth } from './reference-month'

const NOW = new Date('2026-10-12T15:00:00.000Z')

describe('parseReferenceMonth', () => {
  it('ausente: mês corrente em São Paulo', () => {
    expect(parseReferenceMonth(undefined, NOW)).toBe('2026-10')
    expect(parseReferenceMonth(undefined, new Date('2026-11-01T01:00:00.000Z'))).toBe('2026-10')
  })

  it('aceita o mês corrente e meses passados', () => {
    expect(parseReferenceMonth('2026-10', NOW)).toBe('2026-10')
    expect(parseReferenceMonth('2025-01', NOW)).toBe('2025-01')
  })

  it.each(['2026-13', '2026-1', '2026-00', 'outubro', '2026-10-01'])('formato inválido %s → 400', (v) => {
    expect(() => parseReferenceMonth(v, NOW)).toThrow(ValidationError)
  })

  it('mês futuro → 400', () => {
    expect(() => parseReferenceMonth('2026-11', NOW)).toThrow(ValidationError)
  })
})
```

- [ ] **Passo 2: Ver falhar, implementar, ver passar**

```ts
import { ValidationError } from '../../core/errors/core/validation-error'
import { toLocalMonth } from '../reports/shared/period'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** `?month=AAAA-MM` do GET /restaurants/me: padrão o mês corrente; futuro não existe. */
export function parseReferenceMonth (value: string | undefined, now: Date): string {
  const current = toLocalMonth(now)
  if (value == null) return current
  if (!MONTH.test(value)) throw new ValidationError('month inválido: use AAAA-MM.')
  if (value > current) throw new ValidationError('month não pode estar no futuro.')
  return value
}
```

`npx vitest run src/app/restaurant/reference-month.spec.ts` → FAIL antes, PASS depois.

- [ ] **Passo 3: Testes de integração que falham** — `restaurant.int.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { toLocalMonth, addMonths } from '../reports/shared/period'
import { TAX_SCENARIO_EXPECTED, taxScenarioMovements } from '../tax/tax-scenario'

let envCounter = 0
const freshEnv = () => `int_rest_${++envCounter}`

describe('/restaurants/me (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance
  const month = toLocalMonth(new Date())

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
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Cantina ${tag}`, termsAccepted: true, email: `rest_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  const getMe = (auth: Record<string, string>, query = '') => app.inject({ method: 'GET', url: `/restaurants/me${query}`, headers: auth })
  const patchMe = (auth: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/restaurants/me', headers: auth, payload })

  it('sem regime: restaurante + perfil com taxRegimeNotConfigured', async () => {
    const { auth } = await signup(freshEnv())
    const res = await getMe(auth)
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.restaurant).toMatchObject({ name: 'Cantina a' })
    expect(res.json().payload.tax).toMatchObject({ regime: null, referenceMonth: month, rbt12: 0, insights: [{ kind: 'taxRegimeNotConfigured' }] })
  })

  it('PATCH grava o regime; GET mostra o perfil do Simples do cenário', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await mongoConnection.getDatabase(env).collection('financial_movements').insertMany(
      taxScenarioMovements(month, { restaurantId, account: { _id: 'acc', name: 'Caixa', type: 'cash' }, revenueCategory: { _id: 'cat', name: 'Vendas' } }),
    )

    const patched = await patchMe(auth, { taxRegime: 'simplesNacionalAnexoI' })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().payload).toMatchObject({ taxRegime: 'simplesNacionalAnexoI' })

    const tax = (await getMe(auth)).json().payload.tax
    expect(tax).toMatchObject({ regime: 'simplesNacionalAnexoI', rbt12: TAX_SCENARIO_EXPECTED.rbt12, bracket: { index: 3 }, previousBracketIndex: 2 })
    expect(tax.insights[0]).toMatchObject({ kind: 'bracketChanged', fromBracket: 2, toBracket: 3 })

    const lastMonth = (await getMe(auth, `?month=${addMonths(month, -1)}`)).json().payload.tax
    expect(lastMonth).toMatchObject({ referenceMonth: addMonths(month, -1), rbt12: 348_000, bracket: { index: 2 } })
  })

  it('PATCH troca o nome e atualiza o audit', async () => {
    const { auth } = await signup(freshEnv())
    const res = await patchMe(auth, { name: 'Cantina Nova' })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.name).toBe('Cantina Nova')
    expect(res.json().payload.audit.updatedBy).toBeDefined()
  })

  it.each([
    [{ taxRegime: 'lucroReal' }],
    [{ audit: { createdAt: new Date() } }],
    [{ restaurantId: 'outro' }],
  ])('PATCH inválido %j → 400', async (payload) => {
    const { auth } = await signup(freshEnv())
    expect((await patchMe(auth, payload)).statusCode).toBe(400)
  })

  it.each(['?month=2026-13', '?month=2026-1', `?month=${addMonths(month, 1)}`])('GET %s → 400', async (query) => {
    const { auth } = await signup(freshEnv())
    expect((await getMe(auth, query)).statusCode).toBe(400)
  })

  it('sem token → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/restaurants/me', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })

  it('dois restaurantes no mesmo ambiente: cada um vê só o seu', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await mongoConnection.getDatabase(env).collection('financial_movements').insertMany(
      taxScenarioMovements(month, { restaurantId: a.restaurantId, account: { _id: 'acc', name: 'Caixa', type: 'cash' }, revenueCategory: { _id: 'cat', name: 'Vendas' } }),
    )
    await patchMe(b.auth, { taxRegime: 'mei' })

    const meA = (await getMe(a.auth)).json().payload
    const meB = (await getMe(b.auth)).json().payload

    expect(meA.restaurant.name).toBe('Cantina a')
    expect(meA.tax.rbt12).toBe(364_000)
    expect(meB.restaurant).toMatchObject({ name: 'Cantina b', taxRegime: 'mei' })
    expect(meB.tax).toMatchObject({ regime: 'mei', rbt12: 0, meiCap: { yearToDateRevenue: 0 } })
  })
})
```

- [ ] **Passo 4: Ver falhar** — `npx vitest run src/app/restaurant/restaurant.int.spec.ts` → FAIL (404).

- [ ] **Passo 5: Implementar**

`restaurant-repository.ts`:

```ts
import { ObjectId } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'

/** Restaurante do usuário autenticado — o id vem SEMPRE do token (ctx.restaurantId). */
export class RestaurantRepository {
  private col (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection('restaurants')
  }

  private id (ctx: RequestContext): ObjectId {
    if (!ctx.restaurantId || !ObjectId.isValid(ctx.restaurantId)) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return new ObjectId(ctx.restaurantId)
  }

  async findMine (ctx: RequestContext): Promise<any> {
    const doc = await this.col(ctx).findOne({ _id: this.id(ctx) })
    if (!doc) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return doc
  }

  async updateMine (ctx: RequestContext, set: Record<string, unknown>): Promise<any> {
    const doc = await this.col(ctx).findOneAndUpdate({ _id: this.id(ctx) }, { $set: set }, { returnDocument: 'after' })
    if (!doc) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return doc
  }
}
```

`use-cases/get-restaurant-profile.query.ts`:

```ts
import { RestaurantProfileResponse } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { RestaurantRepository } from '../restaurant-repository'
import { TaxProfileQuery } from '../../tax/tax-profile.query'
import { parseReferenceMonth } from '../reference-month'

/** GET /restaurants/me — restaurante + perfil tributário do mês. Read-only. */
export class GetRestaurantProfileQuery {
  constructor (
    private readonly repo: RestaurantRepository = new RestaurantRepository(),
    private readonly taxQuery: TaxProfileQuery = new TaxProfileQuery(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, month: string | undefined): Promise<RestaurantProfileResponse> {
    const referenceMonth = parseReferenceMonth(month, this.clock())
    const restaurant = await this.repo.findMine(ctx)
    const tax = await this.taxQuery.execute(ctx, { regime: restaurant.taxRegime ?? null, referenceMonth })
    return { restaurant, tax }
  }
}
```

`use-cases/update-restaurant.use-case.ts`:

```ts
import { restaurantUpdateSchema } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { RestaurantRepository } from '../restaurant-repository'

/**
 * PATCH /restaurants/me — nome e regime tributário. O schema é estrito: audit,
 * restaurantId e qualquer outro campo são rejeitados (400 pelo error handler).
 * Sem distinção owner × member: nenhuma rota tem hoje (pendência registrada).
 */
export class UpdateRestaurantUseCase {
  constructor (private readonly repo: RestaurantRepository = new RestaurantRepository()) {}

  async execute (ctx: RequestContext, body: unknown): Promise<any> {
    const changes = restaurantUpdateSchema.parse(body ?? {}) as Record<string, unknown>
    if (Object.keys(changes).length === 0) return this.repo.findMine(ctx)
    return this.repo.updateMine(ctx, {
      ...changes,
      'audit.updatedAt': new Date(),
      'audit.updatedBy': ctx.userId,
    })
  }
}
```

`restaurant-controller.ts`:

```ts
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { GetRestaurantProfileQuery } from './use-cases/get-restaurant-profile.query'
import { UpdateRestaurantUseCase } from './use-cases/update-restaurant.use-case'

export class RestaurantController {
  constructor (
    private readonly profileQuery: GetRestaurantProfileQuery = new GetRestaurantProfileQuery(),
    private readonly updateUseCase: UpdateRestaurantUseCase = new UpdateRestaurantUseCase(),
  ) {}

  async me (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const result = await this.profileQuery.execute(ctx, (request.query ?? {}).month)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }

  async updateMe (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const result = await this.updateUseCase.execute(ctx, request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }
}
```

`restaurant-routes.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { RestaurantController } from './restaurant-controller'

export async function restaurantRoutes (fastify: FastifyInstance) {
  const controller = new RestaurantController()

  // GET /restaurants/me?month=AAAA-MM — restaurante + perfil tributário (MIN-23).
  fastify.get('/me', async (request: any, reply) => controller.me(request, reply))

  // PATCH /restaurants/me — body: { name?, taxRegime? }
  fastify.patch('/me', async (request: any, reply) => controller.updateMe(request, reply))
}
```

Em `build-server.ts`, importe `restaurantRoutes` e registre no escopo protegido:
`await protectedScope.register(restaurantRoutes, { prefix: '/restaurants' })`.

- [ ] **Passo 6: Ver passar** — `npx vitest run src/app/restaurant` → PASS. Se `{ restaurantId: 'outro' }` passar com 200, o `restaurantUpdateSchema` não está estrito — confira na lib antes de mexer na API.

- [ ] **Passo 7: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 8: Commit** — `git add src/app/restaurant src/infrastructure/server/build-server.ts && git commit -m "feat(restaurante): GET e PATCH /restaurants/me com perfil tributario (MIN-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 9 — Scripts: backfill, seed do DAS e seed-demo tributário

**Files:** Create `scripts/movements/backfill-dre-group.ts`, `scripts/app/seed-tax-settings.ts`; Modify `scripts/app/seed-demo.ts`, `package.json`.

**Interfaces — Consumes:** `SYSTEM_CATEGORY_DRE_GROUPS` (Tarefa 3), `TAX_SETTINGS_COLLECTION` (Tarefa 7), `taxScenarioMovements`, `TAX_SEED_MARKER`, `TAX_SCENARIO_EXPECTED` (Tarefa 7).

- [ ] **Passo 1: Backfill** — `scripts/movements/backfill-dre-group.ts`:

```ts
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { SYSTEM_CATEGORY_DRE_GROUPS } from '../../src/app/financial-category/category-rules'

/**
 * Migração da fatia 3 (M2): dá `dreGroup` às categorias de DESPESA que ainda não
 * têm. As de sistema recebem o grupo pelo nome (o mesmo mapa do onboarding); as
 * demais, `opex` — o dono corrige pelo PATCH. Sem ela, editar uma despesa antiga
 * ainda funciona (a API completa com opex), mas o DRE não sabe classificá-la.
 *
 * Idempotente: a segunda execução reporta 0. Cross-tenant, como o settler.
 * Uso: `MONGO_ENV=staging npm run db:backfill-dre-group`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  if (!env) throw new Error('MONGO_ENV é obrigatório (ex.: MONGO_ENV=staging npm run db:backfill-dre-group).')

  const connection = MongoDBConnection.getInstance()
  await connection.connect()
  try {
    const categories = connection.getDatabase(env).collection('financial_categories')
    let bySystem = 0
    for (const [name, dreGroup] of Object.entries(SYSTEM_CATEGORY_DRE_GROUPS)) {
      const res = await categories.updateMany({ type: 'expense', isSystem: true, name, dreGroup: { $exists: false } }, { $set: { dreGroup } })
      bySystem += res.modifiedCount
    }
    const rest = await categories.updateMany({ type: 'expense', dreGroup: { $exists: false } }, { $set: { dreGroup: 'opex' } })
    console.log(`dreGroup (env=${env}): ${bySystem} de sistema | ${rest.modifiedCount} como opex`)
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Passo 2: Seed do DAS** — `scripts/app/seed-tax-settings.ts`:

```ts
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../../src/app/environment/env-allowlist'
import { TAX_SETTINGS_COLLECTION } from '../../src/app/tax/tax-settings-repository'

/**
 * Grava/atualiza o DAS mensal do MEI vigente a partir de um mês (MIN-23:
 * "configurável sem alterar código"). Vai no banco `app`, do cluster: uma
 * execução vale para staging e produção. Rodar todo ano quando o salário
 * mínimo mudar (comércio: 5% do mínimo de INSS + R$ 1 de ICMS).
 *
 * Uso: `MEI_MONTHLY_DAS=<valor> VALID_FROM=AAAA-MM npm run db:seed-tax-settings`
 */
async function main (): Promise<void> {
  const das = Number(process.env.MEI_MONTHLY_DAS)
  const validFrom = process.env.VALID_FROM?.trim()
  if (!Number.isFinite(das) || das <= 0) throw new Error('MEI_MONTHLY_DAS deve ser um valor positivo (ex.: MEI_MONTHLY_DAS=82.05).')
  if (!validFrom || !/^\d{4}-(0[1-9]|1[0-2])$/.test(validFrom)) throw new Error('VALID_FROM deve ser AAAA-MM (ex.: VALID_FROM=2026-01).')

  const connection = MongoDBConnection.getInstance()
  await connection.connect()
  try {
    const col = connection.getDatabase(APP_DB).collection(TAX_SETTINGS_COLLECTION)
    await col.updateOne({ validFrom }, { $set: { validFrom, meiMonthlyDas: das, updatedAt: new Date() } }, { upsert: true })
    const all = await col.find({}, { projection: { _id: 0, validFrom: 1, meiMonthlyDas: 1 } }).sort({ validFrom: 1 }).toArray()
    console.log(`DAS MEI em ${APP_DB}.${TAX_SETTINGS_COLLECTION}:`, all)
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Passo 3: seed-demo tributário** — em `scripts/app/seed-demo.ts`, leia `const scenario = (process.env.SEED_SCENARIO ?? 'cash-flow').trim()` e, quando for `'tax'`, em vez do Fluxo de Caixa: apague os movimentos com `description: TAX_SEED_MARKER` do restaurante, insira `taxScenarioMovements(toLocalMonth(new Date()), { restaurantId, account: { _id: 'seed-demo-account', name: 'Demo · Caixa', type: 'cash' }, revenueCategory: { _id: 'seed-demo-revenue', name: 'Vendas (demo)' } })`, defina o regime `simplesNacionalAnexoI` no restaurante (`restaurants.updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })`) e imprima `TAX_SCENARIO_EXPECTED`. Valor diferente de `'cash-flow'`/`'tax'` → erro. Atualize o comentário de uso: `SEED_SCENARIO=tax MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo` (cenários em restaurantes diferentes, recém-criados).

- [ ] **Passo 4: package.json** — depois de `db:seed-demo`:

```json
    "db:backfill-dre-group": "tsx scripts/movements/backfill-dre-group.ts",
    "db:seed-tax-settings": "tsx scripts/app/seed-tax-settings.ts"
```

- [ ] **Passo 5: Verificar contra Mongo em memória** — script scratch (não commitado): subir `MongoMemoryReplSet`, fazer signup via `buildServer().inject`, apagar o `dreGroup` de todas as despesas e criar uma despesa extra sem grupo; rodar `MONGO_ENV=<env> npx tsx scripts/movements/backfill-dre-group.ts` duas vezes (Expected: `4 de sistema | 1 como opex`, depois `0 de sistema | 0 como opex`); rodar `MEI_MONTHLY_DAS=82.05 VALID_FROM=2026-01 npx tsx scripts/app/seed-tax-settings.ts` duas vezes (Expected: um documento só); `MEI_MONTHLY_DAS=-1` → erro; `SEED_SCENARIO=tax` → `GET /restaurants/me` confere `TAX_SCENARIO_EXPECTED`. `npx eslint scripts --ext .ts` limpo.

- [ ] **Passo 6: Commit** — `git add scripts package.json && git commit -m "feat(scripts): backfill do dreGroup, seed do DAS do MEI e cenario tributario no seed-demo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 10 — E2E e Insomnia

**Files:** Create `tests/e2e/restaurant-tax.e2e.spec.ts`; Modify `insomnia/MintlyApi.insomnia_v4.json`.

- [ ] **Passo 1: E2E** — no padrão de `tests/e2e/cash-flow.e2e.spec.ts` (mesmo `beforeAll`/`afterAll`: signup no env `e2e`, `server.listen`, `dropDatabase` no fim), com um teste:

```ts
  it('configura o regime e lê o perfil tributário por HTTP real', async () => {
    const patched = await fetch(`${baseUrl}/restaurants/me`, { method: 'PATCH', headers: auth, body: JSON.stringify({ taxRegime: 'simplesNacionalAnexoI' }) })
    expect(patched.status).toBe(200)

    const created = await fetch(`${baseUrl}/financial-movements/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ direction: 'in', title: 'Vendas E2E', grossValue: 1000, date: new Date().toISOString(), accountId: cashId, categoryId: revenueCatId, paymentMethod: 'pix' }),
    })
    expect(created.status).toBe(201)

    const res = await fetch(`${baseUrl}/restaurants/me`, { headers: auth })
    expect(res.status).toBe(200)
    const { restaurant, tax } = (await res.json() as any).payload
    expect(restaurant.taxRegime).toBe('simplesNacionalAnexoI')
    expect(tax).toMatchObject({ regime: 'simplesNacionalAnexoI', monthsOfHistory: 0, rbt12: 12_000, rbt12Proportional: true, effectiveRate: 0.04, bracket: { index: 1 }, insights: [] })
  })
```

(`revenueCatId` lido do banco como no E2E de movimentação: `type: 'revenue'`.)

- [ ] **Passo 2: Rodar** — `npm run test:e2e` → todos verdes contra o Atlas.

- [ ] **Passo 3: Insomnia** — pasta `Restaurant` (`fld_restaurant`, parent `wrk_mintly`) com `GET {{ _.base_url }}/restaurants/me` e `PATCH {{ _.base_url }}/restaurants/me` (body `{"taxRegime": "simplesNacionalAnexoI"}`, header `Content-Type: application/json`), headers `env` e `Authorization` como os outros. Edite via `json.load`/`json.dump(indent=2, ensure_ascii=False)` e confira que o diff só acrescenta.

- [ ] **Passo 4: Commit** — `git add tests/e2e/restaurant-tax.e2e.spec.ts insomnia/MintlyApi.insomnia_v4.json && git commit -m "test(restaurante): E2E do perfil tributario e insomnia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 11 — Fechar a fatia

- [ ] **Passo 1: PR da lib** — `gh pr create --base staging --title "feat!: classificacao contabil e regime tributario (M2, M5)"` no MintlyLib, corpo com o que entra, o `BREAKING CHANGE` (despesa exige `dreGroup`; `RestaurantClient` só `/me`) e a validação. Aguardar o merge.
- [ ] **Passo 2: Consumir o pacote** — depois da publicação: `npm i mintly-lib@<versão>` na API, `npm run lint && npm run typecheck && npm run test:ci` → verde; commit `chore(deps): consome mintly-lib <versão> (classificacao contabil)`.
- [ ] **Passo 3: Docs** — `andamento.md`: estado da fatia 3, comandos no ambiente (staging: `MONGO_ENV=staging npm run db:backfill-dre-group`; cluster: `MEI_MONTHLY_DAS=<DAS 2026> VALID_FROM=2026-01 npm run db:seed-tax-settings`; produção na release: `MONGO_ENV=production npm run db:backfill-dre-group`), itens do Jira (comentário na MIN-23 com a spec; história/subtarefas da fatia 3) e pendências (owner × member no `PATCH /restaurants/me`). `pendencias-negocio.md`: N6 ganha a nota "implementado na fatia 3". Commit `docs(modulos-novos): andamento da fatia 3`.
- [ ] **Passo 4: PR da API** — push, `gh pr create --base staging --title "feat: classificacao contabil e regime tributario (MIN-23)"`, corpo com contrato, regra, rotas, scripts, critérios da MIN-23 → testes, validação e **os comandos de ambiente**.
- [ ] **Passo 5: CI** — `gh pr checks <n>` até fechar → verde.

---

## Self-review

- **Cobertura da spec:** contrato da categoria → T1; restaurante/perfil/client → T2; regra da categoria → T3; categoria pela API e onboarding → T4; Anexo I, alíquota, `saleTax` → T5; RBT12 proporcional, teto do MEI, insights, perfil → T6; repositórios e query → T7; rotas `/me` → T8; backfill, seed do DAS, seed-demo → T9; E2E e Insomnia → T10; entrega e comandos → T11. Critérios da MIN-23: alíquota nas 6 faixas (T5), imposto por regime (T5), RBT12 automático sem `daily_sales` (T6–T7), alerta de faixa (T6, T8), alerta do teto MEI (T6), RBT12 proporcional (T6), DAS configurável (T7, T9). Margem por prato fica fora (spec).
- **Placeholders:** nenhum; o valor do DAS é parâmetro do script por decisão (T3 da spec).
- **Tipos:** `TaxBracket`, `TaxInsight`, `RestaurantTaxProfile`, `RestaurantProfileResponse` (T2) são os usados em T5–T8; `SYSTEM_CATEGORY_DRE_GROUPS` (T3) é o de T4 e T9; `TAX_SETTINGS_COLLECTION` (T7) é o de T9.
- **Desvio declarado da spec:** `saleTax` recebe `{ rbt12, meiMonthlyDas }` (T5, nota); `seed-demo` escolhe cenário por `SEED_SCENARIO` porque os dois cenários juntos poluem o RBT12 (T9).
- **Review Focus:** os cinco itens têm teste — categoria legada (T4), restaurante vazio (T5/T6 e T8), 22h do último dia (T6/T7), `month` inválido/futuro (T8), DAS não semeado (T7).
