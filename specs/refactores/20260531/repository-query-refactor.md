# Repository `query()` Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a assinatura atual `query<Q>(query: Object | Array<any> | string, ctx): Promise<Q>` (que aceita "qualquer coisa" e adivinha o que é) por um **union discriminado de Query** com `kind` explícito. O contrato fica honesto sobre quais dialetos cada backend suporta, e a porta de fuga (raw query) ainda existe mas é segura em tempo de compilação.

**Architecture:** Define-se um tipo `Query` em `core/crud/query.ts` como union discriminado por `kind` (ex: `'mongo:pipeline'`, `'mongo:filter'`, `'sql:select'`). O repository continua tendo um único método `query()` no interface, mas cada implementação concreta lista nos comentários quais `kind`s suporta e lança `UnsupportedQueryKindError` (novo erro em `core/errors/`) pros outros. Removemos o caso `string` (JSON.parse) — era um adivinhador frágil. Quando vier um backend SQL futuro, basta adicionar o `kind` na union e implementar no novo repository — sem mudar o interface.

**Tech Stack:** TypeScript 5, mongodb v6, Vitest 4

---

## File Structure

**Novos arquivos:**
- `src/core/crud/query.ts` — tipo `Query` (union discriminado) e helpers
- `src/core/errors/core/unsupported-query-kind-error.ts` — erro pra `kind` não suportada
- `src/core/crud/mongodb-crud-repository.spec.ts` — unit tests do método `query()` cobrindo pipeline, filter, e kind inválida

**Arquivos modificados:**
- `src/core/crud/crud-repository-interface.ts` — `query<Q>(q: Query, ctx)` em vez de `Object | Array | string`
- `src/core/crud/mongodb-crud-repository.ts` — implementar com switch no `kind`
- `src/core/crud/crud-use-case.ts` — propagar `Query` em vez de `Object | Array | string`

**Não muda:** `crud-controller.ts` (não expõe `query()` na borda HTTP — é um escape hatch interno), routes, controllers de domínio.

---

## Decisões de design (importantes)

**1. Por que union discriminado em vez de generic per-dialect (`CrudRepository<T, ID, TQuery>`)?**

Generic per-dialect dá mais type safety (`MongodbCrudRepository` aceita só `MongoQuery`, falha em tempo de compilação se vc passar SQL), mas obriga todo caller a carregar o type param `TQuery` mesmo quando só usa CRUD básico. Para o escopo do TCC, o ganho não vale o custo. Union discriminado com erro de runtime se a kind for incompatível resolve o caso comum bem.

**2. Por que remover a variante `string` (JSON.parse)?**

A string parsing era um adivinhador: "é JSON? é objeto? é array?". Frágil, sem type safety, e a kind discriminada substitui isso melhor. Qualquer caller que precisa carregar query de um arquivo `.json` pode fazer `JSON.parse(content) as Query` na borda — não dentro do repository.

**3. Por que `UnsupportedQueryKindError` em runtime e não só em tipo?**

Porque o interface `CrudRepository<T, ID>` é deliberadamente neutro — qualquer caller pode passar qualquer `kind`. Quando o backend não suporta, falhar explícito ajuda no debug e diferencia de erro genérico. O erro também é detectável no `setErrorHandler` global do Fastify pra retornar 501 Not Implemented.

---

## Tasks

### Task 1: Definir o tipo `Query`

**Files:**
- Create: `src/core/crud/query.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
// src/core/crud/query.ts
import type { Document, Filter } from 'mongodb'

export type MongoPipelineQuery = {
  kind: 'mongo:pipeline'
  pipeline: Document[]
}

export type MongoFilterQuery = {
  kind: 'mongo:filter'
  filter: Filter<Document>
}

export type SqlSelectQuery = {
  kind: 'sql:select'
  sql: string
  params?: unknown[]
}

export type Query = MongoPipelineQuery | MongoFilterQuery | SqlSelectQuery

export type QueryKind = Query['kind']
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — arquivo isolado, compila.

- [ ] **Step 3: Commit**

```bash
git add src/core/crud/query.ts
git commit -m "feat(core): definir union discriminado Query"
```

---

### Task 2: Criar `UnsupportedQueryKindError`

**Files:**
- Create: `src/core/errors/core/unsupported-query-kind-error.ts`

- [ ] **Step 1: Olhar a estrutura de erros existentes pra seguir o padrão**

Run: `ls src/core/errors/core/`
Expected: existem outros erros (ex: `not-found-error.ts`, `base-error.ts`). Abrir `not-found-error.ts` mentalmente pra copiar o padrão.

Quick reference do `base-error.ts` esperado: tem `statusCode`, `code`, `apiMessage`. Adaptar.

- [ ] **Step 2: Criar o erro**

```ts
// src/core/errors/core/unsupported-query-kind-error.ts
import { StatusCodes } from 'http-status-codes'
import { BaseError } from './base-error'
import type { QueryKind } from '../../crud/query'

export class UnsupportedQueryKindError extends BaseError {
  constructor (kind: QueryKind, backend: string) {
    super({
      statusCode: StatusCodes.NOT_IMPLEMENTED,
      code: 'UNSUPPORTED_QUERY_KIND',
      apiMessage: `Query kind "${kind}" não é suportada pelo backend "${backend}"`,
    })
  }
}
```

Notas: A assinatura exata do `super({ ... })` depende do `BaseError`. Se for posicional (`super(statusCode, code, apiMessage)`), ajustar. Se o arquivo `base-error.ts` exigir uma forma diferente, adaptar mantendo a semântica: status 501, code `UNSUPPORTED_QUERY_KIND`, mensagem com `kind` e nome do backend.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS — se o construtor do `BaseError` exigir outra forma, ajustar conforme erro do TS.

- [ ] **Step 4: Commit**

```bash
git add src/core/errors/core/unsupported-query-kind-error.ts
git commit -m "feat(core): adicionar UnsupportedQueryKindError"
```

---

### Task 3: Atualizar o interface `CrudRepository`

**Files:**
- Modify: `src/core/crud/crud-repository-interface.ts`

- [ ] **Step 1: Substituir a assinatura de `query`**

Localizar:
```ts
query<Q>(query: Object | Array<any> | string, ctx: RequestContext): Promise<Q>
```

Trocar por:
```ts
query<Q>(q: Query, ctx: RequestContext): Promise<Q>
```

E adicionar o import no topo:
```ts
import { Query } from './query'
```

(O parâmetro foi renomeado de `query` pra `q` pra não conflitar com o nome do método. Pode manter `query` se preferir; só ajustar consistência abaixo.)

- [ ] **Step 2: Typecheck — vai falhar nas implementações e callers**

Run: `npm run typecheck`
Expected: FAIL — `mongodb-crud-repository.ts` e `crud-use-case.ts` vão acusar incompatibilidade. Próximas tasks corrigem.

---

### Task 4: Migrar `MongodbCrudRepository.query()` (TDD)

**Files:**
- Modify: `src/core/crud/mongodb-crud-repository.ts`
- Create: `src/core/crud/mongodb-crud-repository.spec.ts`

- [ ] **Step 1: Escrever os testes que vão falhar**

```ts
// src/core/crud/mongodb-crud-repository.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MongodbCrudRepository } from './mongodb-crud-repository'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'
import type { RequestContext } from '../context/request-context'

describe('MongodbCrudRepository.query', () => {
  const ctx: RequestContext = { env: 'test' }
  let repo: MongodbCrudRepository<any, string>

  let aggregateMock: ReturnType<typeof vi.fn>
  let findMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    aggregateMock = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ ok: 1 }]) })
    findMock = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ ok: 2 }]) })

    const collection = { aggregate: aggregateMock, find: findMock }
    const db = { collection: vi.fn().mockReturnValue(collection) }

    vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({
      getDatabase: vi.fn().mockReturnValue(db),
    } as any)

    repo = new MongodbCrudRepository('any-collection')
  })

  it('executa aggregation pipeline pra kind mongo:pipeline', async () => {
    const pipeline = [{ $match: { active: true } }]
    const result = await repo.query<any[]>({ kind: 'mongo:pipeline', pipeline }, ctx)
    expect(aggregateMock).toHaveBeenCalledWith(pipeline)
    expect(result).toEqual([{ ok: 1 }])
  })

  it('executa find pra kind mongo:filter', async () => {
    const filter = { name: 'Ada' }
    const result = await repo.query<any[]>({ kind: 'mongo:filter', filter }, ctx)
    expect(findMock).toHaveBeenCalledWith(filter)
    expect(result).toEqual([{ ok: 2 }])
  })

  it('lança UnsupportedQueryKindError pra kind sql:select', async () => {
    await expect(
      repo.query({ kind: 'sql:select', sql: 'SELECT 1' }, ctx),
    ).rejects.toBeInstanceOf(UnsupportedQueryKindError)
  })
})
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run src/core/crud/mongodb-crud-repository.spec.ts`
Expected: FAIL — implementação ainda não foi atualizada (testes provavelmente falham com TS error ou erro de runtime de "Tipo de query não suportado").

- [ ] **Step 3: Reescrever o `query()` na implementação Mongo**

Localizar o método `query()` em `mongodb-crud-repository.ts` e substituir o corpo inteiro. Também precisa importar `Query` e `UnsupportedQueryKindError`. Assinatura final:

```ts
import { Query } from './query'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'

// ... resto da classe acima ...

  async query<Q> (q: Query, ctx: RequestContext): Promise<Q> {
    const collection = this.getCollection(ctx)

    switch (q.kind) {
      case 'mongo:pipeline': {
        const result = await collection.aggregate(q.pipeline).toArray()
        return result as Q
      }
      case 'mongo:filter': {
        const result = await collection.find(q.filter as Filter<T>).toArray()
        return result as Q
      }
      default:
        throw new UnsupportedQueryKindError(q.kind, 'mongodb')
    }
  }
```

Notas:
- O switch é exhaustive na compilation: TS narrowing dentro de cada case dá acesso direto a `q.pipeline` / `q.filter` sem cast.
- O `default` cobre kinds futuras (ex: `'sql:select'`) — o `q.kind` no `throw` já vem narrowed como o que sobrou da union, então TS aceita.

- [ ] **Step 4: Rodar pra ver passar**

Run: `npx vitest run src/core/crud/mongodb-crud-repository.spec.ts`
Expected: PASS — 3 testes ok

- [ ] **Step 5: Typecheck total — só `crud-use-case` deve restar quebrado**

Run: `npm run typecheck`
Expected: FAIL só em `crud-use-case.ts`.

---

### Task 5: Atualizar `CrudUseCase.query()`

**Files:**
- Modify: `src/core/crud/crud-use-case.ts`

- [ ] **Step 1: Trocar a assinatura**

Localizar:
```ts
async query<Q> (query: Object | Array<any> | string, ctx: RequestContext): Promise<Q> {
  return await this.repository.query<Q>(query, ctx)
}
```

Trocar por:
```ts
async query<Q> (q: Query, ctx: RequestContext): Promise<Q> {
  return await this.repository.query<Q>(q, ctx)
}
```

E adicionar:
```ts
import { Query } from './query'
```

- [ ] **Step 2: Typecheck final**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Rodar tudo**

Run: `npm run test:ci`
Expected: PASS — testes existentes + 3 novos do Mongo repo

- [ ] **Step 4: Commit do refactor inteiro**

```bash
git add src/core/crud/crud-repository-interface.ts \
        src/core/crud/mongodb-crud-repository.ts \
        src/core/crud/mongodb-crud-repository.spec.ts \
        src/core/crud/crud-use-case.ts
git commit -m "refactor(core): trocar query(Object|Array|string) por union discriminado Query"
```

---

### Task 6: Documentar (no README ou docstring) quais kinds o Mongo backend suporta

**Files:**
- Modify: `src/core/crud/mongodb-crud-repository.ts` (adicionar JSDoc na classe)

- [ ] **Step 1: Adicionar JSDoc curto acima da classe**

```ts
/**
 * Repositório CRUD com backend MongoDB.
 *
 * Suporta os seguintes Query kinds em `.query()`:
 * - `mongo:pipeline` — aggregation pipeline (Document[])
 * - `mongo:filter`   — find com filter (Filter<T>)
 *
 * Lança `UnsupportedQueryKindError` para qualquer outra kind.
 */
export class MongodbCrudRepository<T extends Document, ID> implements CrudRepository<T, ID> {
  // ...
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/crud/mongodb-crud-repository.ts
git commit -m "docs(core): documentar kinds suportadas no MongodbCrudRepository"
```

---

## Próximos passos (fora do escopo desta spec)

1. **Hook no `setErrorHandler`** — adicionar `instanceof UnsupportedQueryKindError` no `build-server.ts` pra responder 501 limpo em vez do 500 genérico. PR pequena depois.
2. **Quando aparecer o backend SQL** — criar `PostgresCrudRepository` (ou similar) que implemente `mongo:*` lançando `UnsupportedQueryKindError` e responda `sql:select`. Sem mexer no interface.
3. **Type-narrowing por backend (opcional)** — se incomodar o fato de poder passar `sql:select` pra `MongodbCrudRepository` em tempo de compilação, considerar generic `CrudRepository<T, ID, TQuery = Query>`. Estimativa: 1h de refactor, ganho ~marginal pro TCC. Pulamos por padrão.

---

## Self-Review

- **Spec coverage:** Tipo Query, erro novo, interface, impl Mongo (com testes), useCase, docstring. ✅
- **Placeholder scan:** Cada step tem código exato ou referência exata ao trecho a alterar. Onde a forma do `BaseError` é incerta, há nota explícita de adaptar mantendo a semântica. ✅
- **Type consistency:** `Query`, `QueryKind`, `UnsupportedQueryKindError`, `RequestContext` consistentes em todas as referências. ✅
