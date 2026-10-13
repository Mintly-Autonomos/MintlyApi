# Fatia 5 — Subcategoria e canal — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo: teste que falha → ver
> falhar → mínimo → ver passar → commit.

**Goal:** subcategorias embutidas na categoria (sub-recurso REST em qualquer categoria) e
`subcategory`/`channel` opcionais na movimentação, com a regra pura do canal efetivo.

**Architecture:** contrato na lib (subdocumento `subcategories`, campos `channel`/`subcategory`,
métodos no client); na API, regras puras (`subcategory-rules.ts`, `resolveMovementSubcategory` em
`movement-rules.ts`, `reports/shared/channel.ts`), um use-case de subcategoria com `$push`/`arrayFilters`
e o registro/edição de movimentação usando a regra.

**Tech Stack:** TypeScript, Fastify 5, MongoDB, Sapphire, Jest (lib), Vitest (API).

**Spec:** `specs/modulos-novos/20261013/subcategoria-canal.md` (aprovada em 13/10/2026).

## Global Constraints

- Nomes em inglês; commits em PT com rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura ≥ 90% (`npm run test:ci`).
- Lib: `feat` **sem** `!` (aditivo).
- Nome de subcategoria: aparado, não vazio, ≤ 60, único na categoria sem diferenciar maiúsculas, contando inativas.
- Só inativação; nada é apagado. Sub-recurso funciona em categoria de sistema.
- Subcategoria e canal opcionais; `null` na edição limpa.
- `effectiveChannel`: informado → ele; entrada em `platform` → `delivery`; outra entrada → `dineIn`; saída → `shared`.
- Erros: entrada inválida → `ValidationError` (400, `APP-0005`); nome repetido → `ConflictError` (409); não encontrado → `NotFoundError` (404).
- Branches `feat/20261013/subcategoria-canal` nos dois repositórios (a da API já existe).

## Review Focus

1. **Categoria antiga sem o campo `subcategories`** — o primeiro `POST` de subcategoria tem que criar a lista (o `$push` cria), sem 500. → Tarefa 3.
2. **Nome que só difere em maiúsculas/espaços** ("Frango" × " frango ") — 409, não duplicata. → Tarefa 2 e 3.
3. **Lançamento antigo cuja subcategoria foi inativada** — editar o título não pode dar 400. → Tarefa 2 e 4.
4. **`subcategoryId` de outro restaurante ou de outra categoria** — 400, nunca grava. → Tarefa 4.
5. **`channel` com valor fora do enum** — 400 pelo schema do documento, não grava. → Tarefa 4.

---

## Tarefa 1 — MintlyLib: subcategoria, canal e client

**Branch:** `git checkout staging && git pull && git checkout -b feat/20261013/subcategoria-canal`

**Files:** Modify `src/core/data/financial/financial-category-schema.ts`, `financial-movement-schema.ts`, `financial-movement-response.ts`, `financial-category-response.ts`, `index.ts` (barrel de financial), `src/clients/financial-category-client.ts`; Tests: `financial-category-schema.spec.ts`, `financial-movement-schema.spec.ts`, `src/clients/financial-category-client.spec.ts` (novo), `src/core/data/financial/index.spec.ts`.

**Interfaces — Produces:** `subcategorySchema`, `subcategoryInsertSchema`, `subcategoryUpdateSchema`, tipo `Subcategory`; `subcategories` (default `[]`) no schema base da categoria; `enum MovementChannel`; `channel?`, `subcategory?` no schema base da movimentação; `subcategoryId?`/`channel?` em `registerMovementSchema`/`updateMovementSchema` e nos tipos `RegisterMovementRequest`/`UpdateMovementRequest` (`UpdateMovementRequest` aceita `null` nos dois); `SubcategoryRequest { name: string }`; client `addSubcategory`, `updateSubcategory`, `inactivateSubcategory`, `reactivateSubcategory`. Todos exportados pelo barrel.

- [ ] **Passo 1: Testes que falham**

Em `financial-category-schema.spec.ts` (importe os novos nomes):

```ts
describe('subcategorias (fatia 5)', () => {
  it('lista padrão vazia; aceita subcategorias válidas', () => {
    const parsed = financialCategorySchema.parse(baseCategory) as any
    expect(parsed.subcategories).toEqual([])
    expect(financialCategorySchema.safeParse({ ...baseCategory, subcategories: [{ _id: 's1', name: 'Frango', status: RecordStatus.Active }] }).success).toBe(true)
  })

  it('subcategoria exige status válido e nome até 60', () => {
    expect(subcategorySchema.safeParse({ _id: 's1', name: 'x'.repeat(61), status: RecordStatus.Active }).success).toBe(false)
    expect(subcategorySchema.safeParse({ _id: 's1', name: 'Frango', status: 'apagada' }).success).toBe(false)
  })

  it('cadastro e edição da categoria não aceitam subcategories', () => {
    const insert = { name: 'X', type: CategoryType.Expense, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.Operational, status: RecordStatus.Active }
    expect(financialCategoryInsertSchema.safeParse({ ...insert, subcategories: [] }).success).toBe(false)
    expect(financialCategoryUpdateSchema.safeParse({ subcategories: [] }).success).toBe(false)
  })

  it('schemas do sub-recurso', () => {
    expect(subcategoryInsertSchema.safeParse({ name: 'Óleo' }).success).toBe(true)
    expect(subcategoryInsertSchema.safeParse({}).success).toBe(false)
    expect(subcategoryUpdateSchema.safeParse({ name: 'Óleo de soja' }).success).toBe(true)
    expect(subcategoryUpdateSchema.safeParse({ status: 'inactive' }).success).toBe(false)
  })
})
```

Em `financial-movement-schema.spec.ts`:

```ts
describe('canal e subcategoria (fatia 5)', () => {
  it('aceita channel e subcategory opcionais', () => {
    expect(financialMovementSchema.safeParse({ ...validInMovement(), channel: MovementChannel.Delivery, subcategory: { _id: 's1', name: 'Frango' } }).success).toBe(true)
    expect(financialMovementSchema.safeParse(validInMovement()).success).toBe(true)
  })

  it('rejeita channel fora do enum', () => {
    expect(financialMovementSchema.safeParse({ ...validInMovement(), channel: 'drive-thru' }).success).toBe(false)
  })

  it('registro e edição aceitam subcategoryId e channel', () => {
    expect(updateMovementSchema.safeParse({ subcategoryId: 's1', channel: MovementChannel.DineIn }).success).toBe(true)
    expect(updateMovementSchema.safeParse({ channel: 'outro' }).success).toBe(false)
  })
})
```

Em `index.spec.ts` (barrel): `expect(financial.MovementChannel.Shared).toBe('shared')` e
`expect(financial.subcategorySchema).toBeDefined()`.

`src/clients/financial-category-client.spec.ts`:

```ts
import { FinancialCategoryClient } from './financial-category-client'

describe('FinancialCategoryClient — subcategorias', () => {
  beforeAll(() => { process.env.BACK_END_URL = 'http://api.test' })
  const headers = { env: 'staging', authorization: 'Bearer t' } as any
  const spy = (client: any, method: 'post' | 'patch') => jest.spyOn(client.http.connection, method).mockResolvedValue({ data: { payload: {} } } as any)

  it('addSubcategory → POST /:id/subcategories', async () => {
    const c = new FinancialCategoryClient()
    const post = spy(c, 'post')
    await (c as any).addSubcategory('c1', { name: 'Frango' }, headers)
    expect(post).toHaveBeenCalledWith('/c1/subcategories', { name: 'Frango' }, expect.anything())
  })

  it('updateSubcategory → PATCH /:id/subcategories/:subId', async () => {
    const c = new FinancialCategoryClient()
    const patch = spy(c, 'patch')
    await (c as any).updateSubcategory('c1', 's1', { name: 'Frango inteiro' }, headers)
    expect(patch).toHaveBeenCalledWith('/c1/subcategories/s1', { name: 'Frango inteiro' }, expect.anything())
  })

  it('inactivate/reactivateSubcategory → PATCH …/inactivate|reactivate', async () => {
    const c = new FinancialCategoryClient()
    const patch = spy(c, 'patch')
    await (c as any).inactivateSubcategory('c1', 's1', headers)
    await (c as any).reactivateSubcategory('c1', 's1', headers)
    expect(patch).toHaveBeenNthCalledWith(1, '/c1/subcategories/s1/inactivate', undefined, expect.anything())
    expect(patch).toHaveBeenNthCalledWith(2, '/c1/subcategories/s1/reactivate', undefined, expect.anything())
  })
})
```

- [ ] **Passo 2: Ver falhar** — `npx jest src/core/data/financial src/clients/financial-category-client.spec.ts` → FAIL (nomes não existem).

- [ ] **Passo 3: Categoria** — em `financial-category-schema.ts`, antes do `baseCategorySchema`:

```ts
/**
 * Subcategoria (M4, fatia 5): detalhe da categoria — CMV/Insumos → Frango, Óleo…
 * Embutida no documento da categoria (poucas, lidas junto, sem $lookup) e
 * gerida só pelo sub-recurso /:id/subcategories. Só inativação, nunca apagada.
 */
export const subcategorySchema = s.object({
  _id: s.string(),
  name: s.string().max(60),
  status: s.type().enum(RecordStatus),
})

/** Corpo de POST /financial-categories/:id/subcategories. */
export const subcategoryInsertSchema = s.object({ name: s.string().max(60) })

/** Corpo de PATCH /financial-categories/:id/subcategories/:subId (status vai por inactivate/reactivate). */
export const subcategoryUpdateSchema = s.object({ name: s.string().max(60) }).partial()
```

No `baseCategorySchema`, depois de `history`: `subcategories: s.array(subcategorySchema).default([]),`.
Os schemas de insert e update **não** mudam (já são estritos e não têm o campo).

Em `financial-category-response.ts` (ou onde vivem os tipos de request da categoria):

```ts
import type { Infer } from '@ascendance-hub/sapphire-core'
import type { subcategorySchema } from './financial-category-schema'

export type Subcategory = Infer<typeof subcategorySchema>

/** Corpo de criação/renomeação de subcategoria. */
export interface SubcategoryRequest {
  name: string
}
```

- [ ] **Passo 4: Movimentação** — em `financial-movement-schema.ts`:

```ts
/**
 * Canal da movimentação (M3, fatia 5). Opcional: ausente, os relatórios usam o
 * canal efetivo (entrada em plataforma → delivery; outra entrada → dineIn;
 * saída → shared). `shared` = da casa inteira (aluguel, energia, contador).
 */
export enum MovementChannel {
  DineIn = 'dineIn',
  Delivery = 'delivery',
  Shared = 'shared',
}
```

No schema base, depois de `account`: 

```ts
  channel: s.type().enum(MovementChannel).optional(),
  // Extended Reference da subcategoria (cópia do nome, como account/category).
  subcategory: s.object({ _id: s.string(), name: s.string() }).optional(),
```

Em `registerMovementSchema`: `subcategoryId: s.string().optional(),` e `channel: s.type().enum(MovementChannel).optional(),`.
Em `updateMovementSchema` (dentro do objeto que vira `.partial()`): `subcategoryId: s.string(),` e `channel: s.type().enum(MovementChannel),`.

Em `financial-movement-response.ts`: `RegisterMovementRequest` ganha `subcategoryId?: string` e
`channel?: MovementChannel`; `UpdateMovementRequest` ganha `subcategoryId?: string | null` e
`channel?: MovementChannel | null` (comentário: `null limpa; a API valida o documento resultante, não este schema`).

- [ ] **Passo 5: Barrel e client** — `financial/index.ts`: exporte `MovementChannel`, `subcategorySchema`,
`subcategoryInsertSchema`, `subcategoryUpdateSchema` e os tipos `Subcategory`, `SubcategoryRequest`.

Em `financial-category-client.ts` (importe `Subcategory`, `SubcategoryRequest`):

```ts
  /** Cria uma subcategoria (funciona também em categoria de sistema). */
  async addSubcategory (categoryId: string, body: SubcategoryRequest, headers: Headers): Promise<ResponseDto<Subcategory>> {
    const response = await this.http.connection.post<ResponseDto<Subcategory>>(`/${categoryId}/subcategories`, body, withHeaders(headers))
    return response.data
  }

  async updateSubcategory (categoryId: string, subcategoryId: string, body: SubcategoryRequest, headers: Headers): Promise<ResponseDto<Subcategory>> {
    const response = await this.http.connection.patch<ResponseDto<Subcategory>>(`/${categoryId}/subcategories/${subcategoryId}`, body, withHeaders(headers))
    return response.data
  }

  async inactivateSubcategory (categoryId: string, subcategoryId: string, headers: Headers): Promise<ResponseDto<Subcategory>> {
    const response = await this.http.connection.patch<ResponseDto<Subcategory>>(`/${categoryId}/subcategories/${subcategoryId}/inactivate`, undefined, withHeaders(headers))
    return response.data
  }

  async reactivateSubcategory (categoryId: string, subcategoryId: string, headers: Headers): Promise<ResponseDto<Subcategory>> {
    const response = await this.http.connection.patch<ResponseDto<Subcategory>>(`/${categoryId}/subcategories/${subcategoryId}/reactivate`, undefined, withHeaders(headers))
    return response.data
  }
```

Tire os `(c as any)` do teste do client.

- [ ] **Passo 6: Ver passar + checagens** — `npx jest && npm run typecheck && npm run lint && npm run build` → verde; `node -e "const l=require('./build');console.log(l.MovementChannel, typeof l.subcategorySchema)"` mostra o enum e `object`.

- [ ] **Passo 7: Commit e push** — `git add src && git commit -m "feat(financial): subcategorias na categoria e canal na movimentacao" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin feat/20261013/subcategoria-canal`

---

## Tarefa 2 — MintlyApi: regras puras

**Files:** Create `src/app/financial-category/subcategory-rules.ts` (+ spec), `src/app/reports/shared/channel.ts` (+ spec); Modify `src/app/financial-movement/movement-rules.ts` (+ spec).

**Interfaces — Produces:**

```ts
// subcategory-rules.ts
export const SUBCATEGORY_NAME_MAX = 60
export function normalizeSubcategoryName (name: unknown): string            // ValidationError se vazio/longo/não string
export function assertUniqueSubcategoryName (existing: Subcategory[] | undefined, name: string, ignoreId?: string): void   // ConflictError
export function findSubcategory (category: { subcategories?: Subcategory[] }, id: string): Subcategory | undefined
// channel.ts
export function effectiveChannel (m: { direction: MovementDirection | string; account: { type: string }; channel?: MovementChannel | string | null }): MovementChannel
// movement-rules.ts
export function resolveMovementSubcategory (p: { category: { subcategories?: Subcategory[] }; current?: { _id: string; name: string }; categoryChanged: boolean; requested: string | null | undefined }): { _id: string; name: string } | undefined
```

- [ ] **Passo 1: Build local da lib** — `cd ../MintlyLib && npm run build && cd ../MintlyApi && rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build` (não commitar).

- [ ] **Passo 2: Testes que falham**

`subcategory-rules.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RecordStatus } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ValidationError } from '../../core/errors/core/validation-error'
import { assertUniqueSubcategoryName, findSubcategory, normalizeSubcategoryName } from './subcategory-rules'

const subs = [
  { _id: 's1', name: 'Frango', status: RecordStatus.Active },
  { _id: 's2', name: 'Óleo', status: RecordStatus.Inactive },
]

describe('normalizeSubcategoryName', () => {
  it('apara espaços', () => expect(normalizeSubcategoryName('  Frango  ')).toBe('Frango'))
  it.each(['', '   ', undefined, 42])('inválido %j → 400', (v) => expect(() => normalizeSubcategoryName(v)).toThrow(ValidationError))
  it('mais de 60 → 400', () => expect(() => normalizeSubcategoryName('x'.repeat(61))).toThrow(ValidationError))
})

describe('assertUniqueSubcategoryName', () => {
  it('repetido sem diferenciar maiúsculas, inclusive inativa → 409', () => {
    expect(() => assertUniqueSubcategoryName(subs, 'frango')).toThrow(ConflictError)
    expect(() => assertUniqueSubcategoryName(subs, 'ÓLEO')).toThrow(ConflictError)
  })
  it('renomear para o próprio nome não conflita; lista ausente aceita', () => {
    expect(() => assertUniqueSubcategoryName(subs, 'FRANGO', 's1')).not.toThrow()
    expect(() => assertUniqueSubcategoryName(undefined, 'Frango')).not.toThrow()
  })
})

describe('findSubcategory', () => {
  it('por _id; lista ausente → undefined', () => {
    expect(findSubcategory({ subcategories: subs }, 's2')?.name).toBe('Óleo')
    expect(findSubcategory({}, 's1')).toBeUndefined()
  })
})
```

`channel.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MovementChannel } from 'mintly-lib'
import { effectiveChannel } from './channel'

describe('effectiveChannel', () => {
  it('canal informado vence', () => expect(effectiveChannel({ direction: 'out', account: { type: 'cash' }, channel: MovementChannel.Delivery })).toBe('delivery'))
  it('entrada em plataforma → delivery', () => expect(effectiveChannel({ direction: 'in', account: { type: 'platform' } })).toBe('delivery'))
  it('outra entrada → dineIn', () => expect(effectiveChannel({ direction: 'in', account: { type: 'cash' }, channel: null })).toBe('dineIn'))
  it('saída → shared', () => expect(effectiveChannel({ direction: 'out', account: { type: 'platform' } })).toBe('shared'))
})
```

Em `movement-rules.spec.ts` (importe `resolveMovementSubcategory`, `RecordStatus`, `ValidationError`):

```ts
describe('resolveMovementSubcategory (fatia 5)', () => {
  const category = { subcategories: [
    { _id: 's1', name: 'Frango', status: RecordStatus.Active },
    { _id: 's2', name: 'Óleo', status: RecordStatus.Inactive },
  ] }
  const current = { _id: 's2', name: 'Óleo' }

  it('nada pedido: mantém se a categoria não mudou; remove se mudou', () => {
    expect(resolveMovementSubcategory({ category, current, categoryChanged: false, requested: undefined })).toEqual(current)
    expect(resolveMovementSubcategory({ category, current, categoryChanged: true, requested: undefined })).toBeUndefined()
  })

  it('null remove', () => {
    expect(resolveMovementSubcategory({ category, current, categoryChanged: false, requested: null })).toBeUndefined()
  })

  it('mesma subcategoria já gravada é mantida mesmo inativa', () => {
    expect(resolveMovementSubcategory({ category, current, categoryChanged: false, requested: 's2' })).toEqual(current)
  })

  it('nova subcategoria ativa da categoria → cópia { _id, name }', () => {
    expect(resolveMovementSubcategory({ category, current, categoryChanged: false, requested: 's1' })).toEqual({ _id: 's1', name: 'Frango' })
  })

  it('inexistente na categoria ou inativa nova → 400', () => {
    expect(() => resolveMovementSubcategory({ category, categoryChanged: true, requested: 'x' })).toThrow(ValidationError)
    expect(() => resolveMovementSubcategory({ category, categoryChanged: true, requested: 's2' })).toThrow(ValidationError)
  })
})
```

- [ ] **Passo 3: Ver falhar** — `npx vitest run src/app/financial-category/subcategory-rules.spec.ts src/app/reports/shared/channel.spec.ts src/app/financial-movement/movement-rules.spec.ts` → FAIL.

- [ ] **Passo 4: Implementar**

`subcategory-rules.ts`:

```ts
import { Subcategory } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ValidationError } from '../../core/errors/core/validation-error'

/** Regras do sub-recurso de subcategorias (M4, fatia 5) — puras. */
export const SUBCATEGORY_NAME_MAX = 60

const key = (name: string) => name.trim().toLocaleLowerCase('pt-BR')

export function normalizeSubcategoryName (name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('Nome da subcategoria é obrigatório.')
  const trimmed = name.trim()
  if (trimmed.length > SUBCATEGORY_NAME_MAX) throw new ValidationError(`Nome da subcategoria tem no máximo ${SUBCATEGORY_NAME_MAX} caracteres.`)
  return trimmed
}

/** Único na categoria, sem diferenciar maiúsculas, contando as inativas (nada é apagado). */
export function assertUniqueSubcategoryName (existing: Subcategory[] | undefined, name: string, ignoreId?: string): void {
  const taken = (existing ?? []).some((s) => s._id !== ignoreId && key(s.name) === key(name))
  if (taken) throw new ConflictError('Já existe uma subcategoria com este nome nesta categoria.')
}

export function findSubcategory (category: { subcategories?: Subcategory[] }, id: string): Subcategory | undefined {
  return (category.subcategories ?? []).find((s) => s._id === id)
}
```

`reports/shared/channel.ts`:

```ts
import { FinancialAccountType, MovementChannel, MovementDirection } from 'mintly-lib'

/**
 * Canal efetivo (M3, S5): o informado pelo dono, ou o padrão — entrada em conta
 * plataforma é delivery; outra entrada é salão; saída é da casa inteira (shared).
 * Resolvido na leitura: dado antigo fica legível sem backfill, e a regra muda num
 * lugar só. Consumido pelos relatórios de custo (fatias 6 e 7).
 */
export function effectiveChannel (m: { direction: MovementDirection | string; account: { type: string }; channel?: MovementChannel | string | null }): MovementChannel {
  if (m.channel != null) return m.channel as MovementChannel
  if (m.direction === MovementDirection.In) {
    return m.account.type === FinancialAccountType.Platform ? MovementChannel.Delivery : MovementChannel.DineIn
  }
  return MovementChannel.Shared
}
```

Em `movement-rules.ts` (imports `RecordStatus`, `Subcategory`; `ValidationError`):

```ts
/**
 * Subcategoria do documento resultante (fatia 5). Opcional sempre (S3). Sem
 * pedido, segue a atual — a menos que a categoria tenha mudado (a subcategoria
 * era da anterior). `null` remove. A mesma já gravada fica mesmo inativa
 * (editar o título de um lançamento antigo não pode falhar); uma nova tem que
 * existir na categoria e estar ativa.
 */
export function resolveMovementSubcategory (p: {
  category: { subcategories?: Subcategory[] }
  current?: { _id: string; name: string }
  categoryChanged: boolean
  requested: string | null | undefined
}): { _id: string; name: string } | undefined {
  if (p.requested === null) return undefined
  if (p.requested === undefined) return p.categoryChanged ? undefined : p.current
  if (!p.categoryChanged && p.current?._id === p.requested) return p.current

  const sub = (p.category.subcategories ?? []).find((s) => s._id === p.requested)
  if (!sub) throw new ValidationError('Subcategoria não pertence à categoria da movimentação.')
  if (sub.status !== RecordStatus.Active) throw new ValidationError('Subcategoria inativa não aceita novos lançamentos.')
  return { _id: sub._id, name: sub.name }
}
```

- [ ] **Passo 5: Ver passar** — mesmo comando → PASS.

- [ ] **Passo 6: Commit** — `git add src/app/financial-category/subcategory-rules* src/app/reports/shared/channel* src/app/financial-movement/movement-rules* && git commit -m "feat(financial): regras puras de subcategoria e canal efetivo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 3 — Sub-recurso de subcategorias

**Files:** Create `src/app/financial-category/use-cases/subcategory.use-case.ts`, `src/app/financial-category/subcategory.int.spec.ts`; Modify `financial-category-repository.ts`, `financial-category-controller.ts`, `financial-category-routes.ts`, `src/app/auth/use-cases/register-use-case.ts`.

**Interfaces — Consumes:** Tarefa 2. **Produces:** `SubcategoryUseCase.add(categoryId, body, ctx)`, `.rename(categoryId, subId, body, ctx)`, `.setStatus(categoryId, subId, status, ctx)` → `Subcategory`; repo `pushSubcategory(categoryId, sub, entry, ctx)` e `setSubcategoryFields(categoryId, subId, fields, entry, ctx)`; as 4 rotas.

- [ ] **Passo 1: Testes de integração que falham** — `subcategory.int.spec.ts` (mesmo `beforeAll`/`afterAll` dos int.spec com `buildServer`; `setup()` faz signup e devolve `auth`, `restaurantId`, `db`):

```ts
  const cmvId = async (db: any, restaurantId: string) => String((await db.collection('financial_categories').findOne({ restaurantId, name: 'CMV/Insumos' }))._id)
  const post = (auth: any, catId: string, payload: unknown) => app.inject({ method: 'POST', url: `/financial-categories/${catId}/subcategories`, headers: auth, payload: payload as any })
  const patch = (auth: any, url: string, payload?: unknown) => app.inject({ method: 'PATCH', url: `/financial-categories/${url}`, headers: auth, payload: payload as any })

  it('cria subcategoria em categoria de sistema (CMV/Insumos) → 201', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    const res = await post(s.auth, id, { name: '  Frango  ' })
    expect(res.statusCode).toBe(201)
    expect(res.json().payload).toMatchObject({ name: 'Frango', status: 'active' })
    const doc = await s.db.collection('financial_categories').findOne({ _id: new ObjectId(id) })
    expect(doc.subcategories).toHaveLength(1)
    expect(doc.history.at(-1)).toMatchObject({ action: 'subcategory:add', detail: 'Frango' })
  })

  it('categoria antiga sem o campo subcategories: o primeiro POST cria a lista', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    await s.db.collection('financial_categories').updateOne({ _id: new ObjectId(id) }, { $unset: { subcategories: '' } })
    expect((await post(s.auth, id, { name: 'Óleo' })).statusCode).toBe(201)
  })

  it('nome repetido (maiúsculas/espaços) → 409; vazio → 400', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    await post(s.auth, id, { name: 'Frango' })
    expect((await post(s.auth, id, { name: ' frango ' })).statusCode).toBe(409)
    expect((await post(s.auth, id, { name: '   ' })).statusCode).toBe(400)
  })

  it('renomeia, inativa e reativa, com history', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    const subId = (await post(s.auth, id, { name: 'Embalagem' })).json().payload._id

    expect((await patch(s.auth, `${id}/subcategories/${subId}`, { name: 'Embalagens' })).json().payload.name).toBe('Embalagens')
    expect((await patch(s.auth, `${id}/subcategories/${subId}/inactivate`)).json().payload.status).toBe('inactive')
    expect((await patch(s.auth, `${id}/subcategories/${subId}/reactivate`)).json().payload.status).toBe('active')

    const doc = await s.db.collection('financial_categories').findOne({ _id: new ObjectId(id) })
    expect(doc.history.slice(-3).map((h: any) => h.action)).toEqual(['subcategory:rename', 'subcategory:inactivate', 'subcategory:reactivate'])
  })

  it('categoria de outro restaurante ou subcategoria inexistente → 404', async () => {
    const a = await setup()
    const b = await setup()
    const idA = await cmvId(a.db, a.restaurantId)
    expect((await post(b.auth, idA, { name: 'Intruso' })).statusCode).toBe(404)
    expect((await patch(a.auth, `${idA}/subcategories/${new ObjectId().toHexString()}`, { name: 'X' })).statusCode).toBe(404)
  })

  it('cadastro de categoria recusa subcategories no corpo → 400', async () => {
    const s = await setup()
    const res = await app.inject({ method: 'POST', url: '/financial-categories', headers: s.auth, payload: { name: 'Nova', type: 'expense', behavior: 'fixed', operationalNature: 'operational', status: 'active', subcategories: [] } })
    expect(res.statusCode).toBe(400)
  })
```

(`setup()` usa um `env` por chamada — `a` e `b` em envs diferentes ainda testam o filtro, porque o
`restaurantId` do token de `b` não casa com o documento de `a`; se quiser o mesmo env, faça dois
signups com o mesmo `env`.)

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/financial-category/subcategory.int.spec.ts` → FAIL (404 nas rotas).

- [ ] **Passo 3: Repositório** — em `financial-category-repository.ts`:

```ts
  /** Acrescenta uma subcategoria (o $push cria a lista em documento antigo). */
  async pushSubcategory (categoryId: string, sub: Subcategory, entry: Record<string, unknown>, ctx: RequestContext): Promise<void> {
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(categoryId), restaurantId: ctx.restaurantId } as any,
      { $push: { subcategories: sub, history: entry } as any, $set: { 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId } },
    )
  }

  /** Altera campos de UMA subcategoria (arrayFilters), registrando no history. */
  async setSubcategoryFields (categoryId: string, subId: string, fields: Partial<Pick<Subcategory, 'name' | 'status'>>, entry: Record<string, unknown>, ctx: RequestContext): Promise<void> {
    const $set: Record<string, unknown> = { 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId }
    for (const [k, v] of Object.entries(fields)) $set[`subcategories.$[s].${k}`] = v
    await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(categoryId), restaurantId: ctx.restaurantId } as any,
      { $set, $push: { history: entry } as any },
      { arrayFilters: [{ 's._id': subId }] },
    )
  }
```

Ainda no `insert` do repositório, acrescente `subcategories: []` ao `scopedItem`.
No onboarding (`register-use-case.ts`), acrescente `subcategories: []` a cada `categoryDocs`.

- [ ] **Passo 4: Use-case** — `use-cases/subcategory.use-case.ts`:

```ts
import { ObjectId } from 'mongodb'
import { RecordStatus, Subcategory, subcategoryInsertSchema, subcategoryUpdateSchema } from 'mintly-lib'
import { FinancialCategoryRepository } from '../financial-category-repository'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { Resource } from '../../../core/types/resource'
import { assertUniqueSubcategoryName, findSubcategory, normalizeSubcategoryName } from '../subcategory-rules'

/**
 * Sub-recurso de subcategorias (M4, fatia 5). Funciona em QUALQUER categoria do
 * restaurante, inclusive de sistema (S2): não passa pelo PATCH da categoria, que
 * segue travado para sistema. Cada mudança vai para o history da categoria.
 */
export class SubcategoryUseCase {
  constructor (private readonly repo: FinancialCategoryRepository = new FinancialCategoryRepository()) {}

  private async category (categoryId: string, ctx: RequestContext): Promise<any> {
    if (!ObjectId.isValid(categoryId)) throw new NotFoundError(Resource.FinancialCategory, categoryId)
    const category = await this.repo.find({ _id: categoryId as any, restaurantId: ctx.restaurantId } as any, ctx)
    if (!category) throw new NotFoundError(Resource.FinancialCategory, categoryId)
    return category
  }

  private entry (ctx: RequestContext, action: string, detail: string) {
    return { at: new Date(), by: ctx.userId ?? 'system', action, detail }
  }

  async add (categoryId: string, body: unknown, ctx: RequestContext): Promise<Subcategory> {
    const { name: raw } = subcategoryInsertSchema.parse(body ?? {}) as { name: string }
    const category = await this.category(categoryId, ctx)
    const name = normalizeSubcategoryName(raw)
    assertUniqueSubcategoryName(category.subcategories, name)
    const sub: Subcategory = { _id: new ObjectId().toHexString(), name, status: RecordStatus.Active }
    await this.repo.pushSubcategory(categoryId, sub, this.entry(ctx, 'subcategory:add', name), ctx)
    return sub
  }

  async rename (categoryId: string, subId: string, body: unknown, ctx: RequestContext): Promise<Subcategory> {
    const changes = subcategoryUpdateSchema.parse(body ?? {}) as { name?: string }
    const category = await this.category(categoryId, ctx)
    const sub = findSubcategory(category, subId)
    if (!sub) throw new NotFoundError('Subcategory', subId)
    if (changes.name === undefined) return sub
    const name = normalizeSubcategoryName(changes.name)
    assertUniqueSubcategoryName(category.subcategories, name, subId)
    await this.repo.setSubcategoryFields(categoryId, subId, { name }, this.entry(ctx, 'subcategory:rename', `${sub.name} → ${name}`), ctx)
    return { ...sub, name }
  }

  async setStatus (categoryId: string, subId: string, status: RecordStatus, ctx: RequestContext): Promise<Subcategory> {
    const category = await this.category(categoryId, ctx)
    const sub = findSubcategory(category, subId)
    if (!sub) throw new NotFoundError('Subcategory', subId)
    if (sub.status === status) return sub
    const action = status === RecordStatus.Active ? 'subcategory:reactivate' : 'subcategory:inactivate'
    await this.repo.setSubcategoryFields(categoryId, subId, { status }, this.entry(ctx, action, sub.name), ctx)
    return { ...sub, status }
  }
}
```

- [ ] **Passo 5: Controller e rotas** — o controller recebe o use-case no construtor (último parâmetro, com padrão `new SubcategoryUseCase(repo)` nas rotas) e ganha:

```ts
  async addSubcategory (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const sub = await this.subcategories.add(request.params.id, request.body, ctx)
    return new ResponseBuilder().status(StatusCodes.CREATED).payload(sub).send(reply)
  }

  async renameSubcategory (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const sub = await this.subcategories.rename(request.params.id, request.params.subId, request.body, ctx)
    return new ResponseBuilder().status(StatusCodes.OK).payload(sub).send(reply)
  }

  async setSubcategoryStatus (request: any, reply: any, status: RecordStatus) {
    const ctx = buildRequestContext(request)
    const sub = await this.subcategories.setStatus(request.params.id, request.params.subId, status, ctx)
    return new ResponseBuilder().status(StatusCodes.OK).payload(sub).send(reply)
  }
```

Em `financial-category-routes.ts`:

```ts
  // Sub-recurso de subcategorias (fatia 5) — vale também para categoria de sistema.
  fastify.post('/:id/subcategories', async (request: any, reply) => controller.addSubcategory(request, reply))
  fastify.patch('/:id/subcategories/:subId', async (request: any, reply) => controller.renameSubcategory(request, reply))
  fastify.patch('/:id/subcategories/:subId/inactivate', async (request: any, reply) => controller.setSubcategoryStatus(request, reply, RecordStatus.Inactive))
  fastify.patch('/:id/subcategories/:subId/reactivate', async (request: any, reply) => controller.setSubcategoryStatus(request, reply, RecordStatus.Active))
```

Atualize o teste unitário do controller se a assinatura do construtor mudar (passe um mock do use-case).

- [ ] **Passo 6: Ver passar** — `npx vitest run src/app/financial-category src/app/auth` → PASS.

- [ ] **Passo 7: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde.

- [ ] **Passo 8: Commit** — `git add src/app/financial-category src/app/auth/use-cases/register-use-case.ts && git commit -m "feat(categoria): sub-recurso de subcategorias" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 4 — Movimentação com subcategoria e canal

**Files:** Modify `register-movement.use-case.ts`, `update-movement.use-case.ts`; Create `src/app/financial-movement/use-cases/subcategory-channel.int.spec.ts`.

**Interfaces — Consumes:** `resolveMovementSubcategory` (T2), rotas do sub-recurso (T3).

- [ ] **Passo 1: Testes de integração que falham** — `subcategory-channel.int.spec.ts` (setup como `settled-at.int.spec.ts`: signup, `cashId`, CMV/Insumos e Aluguel do onboarding; cria `s1 = Frango` e `s2 = Óleo` via `POST /financial-categories/:cmvId/subcategories`):

```ts
  const register = (auth: any, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: { direction: 'out', title: 'Compra', grossValue: 100, date: new Date().toISOString(), paymentMethod: 'pix', confirmDuplicate: true, ...payload } })
  const update = (auth: any, id: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: auth, payload })
  const stored = (db: any, id: string) => db.collection('financial_movements').findOne({ _id: new ObjectId(id) })

  it('registra com subcategoria e canal', async () => {
    const s = await setup()
    const res = await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId, channel: 'delivery' })
    expect(res.statusCode).toBe(201)
    expect(await stored(s.db, res.json().payload._id)).toMatchObject({ subcategory: { _id: s.frangoId, name: 'Frango' }, channel: 'delivery' })
  })

  it('subcategoria de outra categoria ou inativa → 400; canal fora do enum → 400', async () => {
    const s = await setup()
    await app.inject({ method: 'PATCH', url: `/financial-categories/${s.cmvId}/subcategories/${s.oleoId}/inactivate`, headers: s.auth })
    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.aluguelId, subcategoryId: s.frangoId })).statusCode).toBe(400)
    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.oleoId })).statusCode).toBe(400)
    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, channel: 'drive-thru' })).statusCode).toBe(400)
    expect(await s.db.collection('financial_movements').countDocuments({ restaurantId: s.restaurantId })).toBe(0)
  })

  it('edição: trocar a categoria limpa a subcategoria; null limpa subcategoria e canal', async () => {
    const s = await setup()
    const a = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId, channel: 'dineIn' })).json().payload._id
    expect((await update(s.auth, a, { categoryId: s.aluguelId })).statusCode).toBe(200)
    expect((await stored(s.db, a)).subcategory).toBeUndefined()

    const b = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId, channel: 'dineIn' })).json().payload._id
    await update(s.auth, b, { subcategoryId: null, channel: null })
    const doc = await stored(s.db, b)
    expect(doc.subcategory).toBeUndefined()
    expect(doc.channel).toBeUndefined()
  })

  it('lançamento antigo com subcategoria depois inativada: editar o título funciona e a mantém', async () => {
    const s = await setup()
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.oleoId })).json().payload._id
    await app.inject({ method: 'PATCH', url: `/financial-categories/${s.cmvId}/subcategories/${s.oleoId}/inactivate`, headers: s.auth })

    const res = await update(s.auth, id, { title: 'Óleo de soja' })

    expect(res.statusCode).toBe(200)
    expect((await stored(s.db, id)).subcategory).toEqual({ _id: s.oleoId, name: 'Óleo' })
  })

  it('renomear a subcategoria não reescreve lançamentos gravados', async () => {
    const s = await setup()
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId })).json().payload._id
    await app.inject({ method: 'PATCH', url: `/financial-categories/${s.cmvId}/subcategories/${s.frangoId}`, headers: s.auth, payload: { name: 'Frango inteiro' } })
    expect((await stored(s.db, id)).subcategory.name).toBe('Frango')
  })

  it('trocar para outra subcategoria da mesma categoria', async () => {
    const s = await setup()
    const extra = (await app.inject({ method: 'POST', url: `/financial-categories/${s.cmvId}/subcategories`, headers: s.auth, payload: { name: 'Molhos' } })).json().payload._id
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId })).json().payload._id
    await update(s.auth, id, { subcategoryId: extra })
    expect((await stored(s.db, id)).subcategory).toEqual({ _id: extra, name: 'Molhos' })
  })
```

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/financial-movement/use-cases/subcategory-channel.int.spec.ts` → FAIL.

- [ ] **Passo 3: Registro** — em `register-movement.use-case.ts`: `RegisterMovementInput` ganha `subcategoryId?: string` e `channel?: string`; importe `resolveMovementSubcategory`; depois de montar `doc` (junto dos opcionais):

```ts
        // Fatia 5: subcategoria (opcional, tem que ser da categoria e ativa) e canal.
        const subcategory = resolveMovementSubcategory({ category: category as any, categoryChanged: true, requested: input.subcategoryId })
        if (subcategory) doc.subcategory = subcategory
        if (input.channel != null) doc.channel = input.channel
```

(O `financialMovementSchema.parse(doc)` que já existe recusa `channel` fora do enum → 400.)

- [ ] **Passo 4: Edição** — em `update-movement.use-case.ts`: `UpdateMovementInput` ganha `subcategoryId?: string | null` e `channel?: string | null`. Guarde o documento da categoria buscada (`let categoryDoc: any = null`; dentro do `if (changes.categoryId)`, `categoryDoc = cat`). Depois do `categorySnap`:

```ts
        // Fatia 5: subcategoria segue a regra pura; o documento da categoria só é
        // lido quando há subcategoria nova para validar.
        const categoryChanged = changes.categoryId != null && changes.categoryId !== String(mov.category?._id)
        if (!categoryDoc && changes.subcategoryId) {
          categoryDoc = await categories.findOne({ _id: new ObjectId(String(mov.category._id)), restaurantId: ctx.restaurantId }, { session })
        }
        const subcategory = resolveMovementSubcategory({
          category: categoryDoc ?? {},
          current: mov.subcategory ?? undefined,
          categoryChanged,
          requested: changes.subcategoryId,
        })
        const channel = 'channel' in changes ? changes.channel : mov.channel
```

e, junto dos opcionais do `newDoc`:

```ts
        if (subcategory) newDoc.subcategory = subcategory
        if (channel != null) newDoc.channel = channel
```

- [ ] **Passo 5: Ver passar** — `npx vitest run src/app/financial-movement` → PASS.

- [ ] **Passo 6: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 7: Commit** — `git add src/app/financial-movement && git commit -m "feat(movimento): subcategoria e canal no registro e na edicao" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 5 — E2E e Insomnia

- [ ] **Passo 1: E2E** — `tests/e2e/subcategory-channel.e2e.spec.ts` no padrão de `result.e2e.spec.ts` (signup no env `e2e`, `cashId`, `cmvCatId` de CMV/Insumos, `dropDatabase` no fim):

```ts
  it('cria subcategoria em CMV/Insumos e lança despesa com ela e canal delivery', async () => {
    const sub = await fetch(`${baseUrl}/financial-categories/${cmvCatId}/subcategories`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Frango' }) })
    expect(sub.status).toBe(201)
    const subId = (await sub.json() as any).payload._id

    const created = await fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ direction: 'out', title: 'Frango E2E', grossValue: 250, date: new Date().toISOString(), accountId: cashId, categoryId: cmvCatId, subcategoryId: subId, channel: 'delivery', paymentMethod: 'pix' }) })
    expect(created.status).toBe(201)
    expect((await created.json() as any).payload).toMatchObject({ subcategory: { _id: subId, name: 'Frango' }, channel: 'delivery' })
  })
```

`npm run test:e2e` → todos verdes.

- [ ] **Passo 2: Insomnia** — na pasta das categorias, 4 requisições: `POST …/financial-categories/{{ _.category_id }}/subcategories` (body `{"name":"Frango"}`), `PATCH …/subcategories/{{ _.subcategory_id }}` (body `{"name":"Frango inteiro"}`), `PATCH …/inactivate`, `PATCH …/reactivate`; mesmos headers; diff só acrescenta.

- [ ] **Passo 3: Commit** — `git add tests/e2e/subcategory-channel.e2e.spec.ts insomnia/MintlyApi.insomnia_v4.json && git commit -m "test(financial): E2E de subcategoria e canal e insomnia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 6 — Fechar a fatia

- [ ] PR da lib (`feat(financial): subcategorias e canal (M3, M4)`) → merge → `npm i mintly-lib@<versão>` na API → suíte → commit `chore(deps)`.
- [ ] `andamento.md` (fatia 5 em review; pendências da revisão; Jira) → commit `docs(modulos-novos): andamento da fatia 5`.
- [ ] PR da API (`feat(financial): subcategorias e canal (M3, M4)`) com contrato, regras, validação e "nenhum comando novo"; `gh pr checks` verde.

---

## Self-review

- **Cobertura da spec:** contrato → T1; regras puras (nome, unicidade, busca, canal efetivo, subcategoria na edição) → T2; sub-recurso (201 em sistema, 409, 400, rename/inativar/reativar com history, 404, categoria sem o campo, cadastro recusa `subcategories`) → T3; registro/edição (gravação, 400s, trocar categoria, `null`, inativa mantida, rename não reescreve) → T4; E2E e Insomnia → T5.
- **Placeholders:** nenhum.
- **Tipos:** `Subcategory` (T1) usado em T2–T4; `resolveMovementSubcategory` (T2) com a mesma assinatura em T4.
- **Ruling antecipado:** a API não usa `registerMovementSchema`/`updateMovementSchema` da lib para validar corpo — valida o documento resultante com `financialMovementSchema`; por isso `channel` inválido vira 400 pelo schema do documento, e o `null` na edição não precisa estar no schema de update da lib (só nos tipos de request).
- **Review Focus:** os cinco têm teste — categoria sem o campo (T3), nome case/espaço (T2, T3), subcategoria inativa já gravada (T2, T4), subcategoria de outra categoria (T4), canal fora do enum (T4).
