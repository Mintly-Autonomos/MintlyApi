# RequestContext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o parâmetro `env: string` espalhado pelas camadas por um objeto `RequestContext` explícito, mantendo o roteamento de banco por env e abrindo espaço pra campos futuros (`userId`, `traceId`, `logger`) sem precisar refatorar todas as assinaturas de novo.

**Architecture:** Threading explícito de um objeto `RequestContext` da borda HTTP até o repository — sem AsyncLocalStorage. Builder vive em `core/context/` e é chamado no `CrudController` a partir dos headers do request. UseCase e Repository passam a receber `ctx: RequestContext` como último argumento. Threading foi escolhido em vez de AsyncLocalStorage porque (1) dependências explícitas são mais defensáveis em arquitetura em camadas e (2) testabilidade fica trivial — basta construir um `RequestContext` literal no teste.

**Tech Stack:** TypeScript 5, Fastify 5, Node ≥22, Vitest 4

---

## File Structure

**Novos arquivos:**
- `src/core/context/request-context.ts` — interface `RequestContext`
- `src/core/context/build-request-context.ts` — função `buildRequestContext(headers)`
- `src/core/context/build-request-context.spec.ts` — unit tests do builder

**Arquivos modificados:**
- `src/core/crud/crud-repository-interface.ts` — `env: string` → `ctx: RequestContext`
- `src/core/crud/mongodb-crud-repository.ts` — ler `ctx.env`
- `src/core/crud/crud-use-case.ts` — propagar `ctx`
- `src/core/crud/crud-controller.ts` — chamar `buildRequestContext(headers)`, passar `ctx` adiante

**Arquivos deletados:**
- `src/core/utils/get-env.ts` — única chamada era no `crud-controller`; a lógica migra pra dentro do builder

**Não muda:** routes, person-controller, person-repository, person-routes.spec — o comportamento da base muda na assinatura, mas Person herda tudo.

---

## Tasks

### Task 1: Criar a interface RequestContext

**Files:**
- Create: `src/core/context/request-context.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
export interface RequestContext {
  env: string
  // Campos futuros previstos (adicionar quando necessário):
  // userId?: string
  // traceId?: string
  // logger?: Logger
}
```

- [ ] **Step 2: Typecheck pra garantir que o arquivo isolado compila**

Run: `npm run typecheck`
Expected: zero erros

- [ ] **Step 3: Commit**

```bash
git add src/core/context/request-context.ts
git commit -m "feat(core): introduzir interface RequestContext"
```

---

### Task 2: Builder de RequestContext (TDD)

**Files:**
- Create: `src/core/context/build-request-context.spec.ts`
- Create: `src/core/context/build-request-context.ts`

- [ ] **Step 1: Escrever o teste que vai falhar**

```ts
// src/core/context/build-request-context.spec.ts
import { describe, it, expect } from 'vitest'
import { buildRequestContext } from './build-request-context'

describe('buildRequestContext', () => {
  it('extrai env do header "env"', () => {
    const ctx = buildRequestContext({ env: 'staging' })
    expect(ctx.env).toBe('staging')
  })

  it('default para "default" quando o header está ausente', () => {
    const ctx = buildRequestContext(undefined)
    expect(ctx.env).toBe('default')
  })

  it('default para "default" quando o header existe mas não tem env', () => {
    const ctx = buildRequestContext({ 'content-type': 'application/json' })
    expect(ctx.env).toBe('default')
  })

  it('coage env não-string pra string', () => {
    const ctx = buildRequestContext({ env: ['production'] as any })
    expect(ctx.env).toBe('production')
  })
})
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run src/core/context/build-request-context.spec.ts`
Expected: FAIL — `Cannot find module './build-request-context'` ou erro de import

- [ ] **Step 3: Implementar o mínimo pra passar**

```ts
// src/core/context/build-request-context.ts
import { IncomingHttpHeaders } from 'http'
import { RequestContext } from './request-context'

export function buildRequestContext (headers?: IncomingHttpHeaders): RequestContext {
  const env = headers?.env ?? 'default'
  return {
    env: Array.isArray(env) ? String(env[0]) : String(env),
  }
}
```

- [ ] **Step 4: Rodar pra ver passar**

Run: `npx vitest run src/core/context/build-request-context.spec.ts`
Expected: PASS — 4 testes ok

- [ ] **Step 5: Commit**

```bash
git add src/core/context/build-request-context.ts src/core/context/build-request-context.spec.ts
git commit -m "feat(core): adicionar buildRequestContext a partir dos headers"
```

---

### Task 3: Migrar a interface CrudRepository

**Files:**
- Modify: `src/core/crud/crud-repository-interface.ts`

- [ ] **Step 1: Substituir todas as ocorrências de `env: string` por `ctx: RequestContext`**

```ts
// src/core/crud/crud-repository-interface.ts
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'

export interface CrudRepository<T, ID> {
  insert(item: T, ctx: RequestContext): Promise<T>
  findById(id: ID, ctx: RequestContext): Promise<T | null>
  find(filter: Partial<T>, ctx: RequestContext): Promise<T>
  findAll(filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>>
  update(id: ID, item: Partial<T>, ctx: RequestContext): Promise<T>
  delete(id: ID, ctx: RequestContext): Promise<void>
  query<Q>(query: Object | Array<any> | string, ctx: RequestContext): Promise<Q>
}
```

- [ ] **Step 2: Typecheck — vai falhar nas implementações e nos chamadores**

Run: `npm run typecheck`
Expected: FAIL com erros em `mongodb-crud-repository.ts` e `crud-use-case.ts` (assinaturas desalinhadas). Isso é esperado e vai ser corrigido nas próximas tasks.

- [ ] **Step 3: NÃO commitar ainda — a base está quebrada até Task 6**

Quebrar o build de forma intermediária é OK durante o refactor, mas o commit acontece só quando o flow inteiro estiver passando. Próxima task continua sem commit.

---

### Task 4: Migrar MongodbCrudRepository

**Files:**
- Modify: `src/core/crud/mongodb-crud-repository.ts`

- [ ] **Step 1: Substituir `env: string` por `ctx: RequestContext` e ler `ctx.env`**

```ts
// src/core/crud/mongodb-crud-repository.ts
import { Collection, ObjectId, Filter, Document } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'

export class MongodbCrudRepository<T extends Document, ID> implements CrudRepository<T, ID> {
  constructor (
    private readonly collectionName: string,
  ) {}

  private getCollection (ctx: RequestContext): Collection<T> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    return db.collection<T>(this.collectionName)
  }

  async insert (item: T, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)
    const result = await collection.insertOne(item as any)
    return { ...item, _id: result.insertedId } as T
  }

  async findById (id: ID, ctx: RequestContext): Promise<T | null> {
    const collection = this.getCollection(ctx)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const result = await collection.findOne(filter)
    return result as T | null
  }

  async find (filter: Partial<T>, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)
    const result = await collection.findOne(filter as Filter<T>)
    return result as T
  }

  async findAll (filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>> {
    const collection = this.getCollection(ctx)
    const { page = 1, size = 10, orderBy, orderDirection = 'asc', createdAtDirection, ...queryFilter } = filter

    const skip = (page - 1) * size
    const sort: any = {}

    if (orderBy) {
      sort[orderBy] = orderDirection === 'asc' ? 1 : -1
    }

    if (createdAtDirection) {
      sort.createdAt = createdAtDirection === 'asc' ? 1 : -1
    }

    const result = await collection
      .find(queryFilter as Filter<T>)
      .sort(sort)
      .skip(skip)
      .limit(size)
      .toArray()

    return result as T[]
  }

  async update (id: ID, item: Partial<T>, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const updateDoc = { $set: item }

    const result = await collection.findOneAndUpdate(
      filter,
      updateDoc,
      { returnDocument: 'after' },
    )

    if (!result) {
      throw new Error(`Item com id ${id} não encontrado`)
    }

    return result as T
  }

  async delete (id: ID, ctx: RequestContext): Promise<void> {
    const collection = this.getCollection(ctx)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const result = await collection.deleteOne(filter)

    if (result.deletedCount === 0) {
      throw new Error(`Item com id ${id} não encontrado`)
    }
  }

  async query<Q> (query: Object | Array<any> | string, ctx: RequestContext): Promise<Q> {
    const collection = this.getCollection(ctx)

    if (Array.isArray(query)) {
      const result = await collection.aggregate(query).toArray()
      return result as Q
    }

    if (typeof query === 'object' && query !== null) {
      const result = await collection.find(query as Filter<T>).toArray()
      return result as Q
    }

    if (typeof query === 'string') {
      try {
        const parsedQuery = JSON.parse(query)
        if (Array.isArray(parsedQuery)) {
          const result = await collection.aggregate(parsedQuery).toArray()
          return result as Q
        }
        const result = await collection.find(parsedQuery as Filter<T>).toArray()
        return result as Q
      } catch (error) {
        throw new Error('Query string inválida. Deve ser um JSON válido.')
      }
    }

    throw new Error('Tipo de query não suportado')
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: ainda FAIL — agora só em `crud-use-case.ts` e `crud-controller.ts`. Erros em `mongodb-crud-repository.ts` devem ter sumido.

---

### Task 5: Migrar CrudUseCase

**Files:**
- Modify: `src/core/crud/crud-use-case.ts`

- [ ] **Step 1: Substituir `env: string` por `ctx: RequestContext`**

```ts
// src/core/crud/crud-use-case.ts
import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'

export class CrudUseCase<T, ID> {
  constructor (private readonly repository: CrudRepository<T, ID>) {}

  async insert (item: T, ctx: RequestContext): Promise<T> {
    return await this.repository.insert(item, ctx)
  }

  async findById (id: ID, ctx: RequestContext): Promise<T | null> {
    return await this.repository.findById(id, ctx)
  }

  async find (filter: Partial<T>, ctx: RequestContext): Promise<T> {
    return await this.repository.find(filter, ctx)
  }

  async findAll (filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>> {
    const response = await this.repository.findAll(filter, ctx)
    return response
  }

  async update (id: ID, item: Partial<T>, ctx: RequestContext): Promise<T> {
    return await this.repository.update(id, item, ctx)
  }

  async delete (id: ID, ctx: RequestContext): Promise<void> {
    await this.repository.delete(id, ctx)
  }

  async query<Q> (query: Object | Array<any> | string, ctx: RequestContext): Promise<Q> {
    return await this.repository.query<Q>(query, ctx)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: ainda FAIL — agora só em `crud-controller.ts`.

---

### Task 6: Migrar CrudController e deletar GetEnv

**Files:**
- Modify: `src/core/crud/crud-controller.ts`
- Delete: `src/core/utils/get-env.ts`

- [ ] **Step 1: Trocar `GetEnv.getEnv(headers)` por `buildRequestContext(headers)` e propagar ctx**

```ts
// src/core/crud/crud-controller.ts
import { CrudRepository } from './crud-repository-interface'
import { CrudUseCase } from './crud-use-case'
import { IncomingHttpHeaders } from 'http'
import { buildRequestContext } from '../context/build-request-context'
import { PaginationDto } from 'mintly-lib'
import { Field } from '@ascendance-hub/sapphire-core'
import { NotFoundError } from '../errors/core/not-found-error'
import { Resource } from '../types/resource'
import { ResponseBuilder } from '../builders/response-builder/response-builder'
import { StatusCodes } from 'http-status-codes'

export class CrudController <T extends Record<string, any>, ID = any> {
  private readonly useCase: CrudUseCase<T, ID>

  constructor (
    private readonly repository: CrudRepository<T, ID>,
    private readonly orm: Field,
  ) {
    const useCase = new CrudUseCase<T, ID>(this.repository)
    this.useCase = useCase
  }

  async insert (item: T, headers?: IncomingHttpHeaders): Promise<T> {
    const ctx = buildRequestContext(headers)

    this.orm.parse(item)

    const result = await this.useCase.insert(item, ctx)

    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async findById (id: ID, headers?: IncomingHttpHeaders): Promise<T | null> {
    const ctx = buildRequestContext(headers)
    const result = await this.useCase.findById(id, ctx)
    if (!result) {
      throw new NotFoundError(Resource.Person, id)
    }

    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async find (filter: Partial<T>, headers?: IncomingHttpHeaders): Promise<T> {
    const ctx = buildRequestContext(headers)
    const result = await this.useCase.find(filter, ctx)

    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async findAll (filter: Partial<T> & PaginationDto, headers?: IncomingHttpHeaders): Promise<Array<T>> {
    const ctx = buildRequestContext(headers)
    const result = await this.useCase.findAll(filter, ctx)

    return new ResponseBuilder()
      .payload(result)
      .pagination({
        ...filter,
        totalItems: result.length,
        totalPages: Math.ceil(result.length / (filter.size || 10)),
      })
      .build()
  }

  async update (id: ID, item: Partial<T>, headers?: IncomingHttpHeaders): Promise<T> {
    const ctx = buildRequestContext(headers)

    this.orm.parse(item)

    const result = await this.useCase.update(id, item, ctx)
    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async delete (id: ID, headers?: IncomingHttpHeaders): Promise<void> {
    const ctx = buildRequestContext(headers)
    await this.useCase.delete(id, ctx)

    return new ResponseBuilder()
      .status(StatusCodes.NO_CONTENT)
      .build()
  }
}
```

- [ ] **Step 2: Deletar `get-env.ts` (única chamada migrou pra `buildRequestContext`)**

```bash
rm src/core/utils/get-env.ts
```

- [ ] **Step 3: Typecheck — agora deve passar**

Run: `npm run typecheck`
Expected: PASS (zero erros)

- [ ] **Step 4: Rodar todos os testes**

Run: `npm run test:ci`
Expected: PASS — os 2 testes existentes (`health`, `swagger`) não tocam essa camada, então continuam ok. Os 4 testes novos do `buildRequestContext` também passam.

- [ ] **Step 5: Commit do refactor inteiro**

```bash
git add src/core/crud/crud-repository-interface.ts \
        src/core/crud/mongodb-crud-repository.ts \
        src/core/crud/crud-use-case.ts \
        src/core/crud/crud-controller.ts
git rm src/core/utils/get-env.ts
git commit -m "refactor(core): trocar env:string por RequestContext em todas as camadas"
```

---

### Task 7: Verificação final (smoke test manual)

**Files:** nenhum

- [ ] **Step 1: Subir o servidor em modo dev**

Run: `npm run dev`
Expected: servidor sobe em `http://localhost:3000` sem erro de boot.

- [ ] **Step 2: Bater no health**

Run (em outro terminal): `curl -i http://localhost:3000/health`
Expected: `HTTP/1.1 200 OK` com body `{"status":"ok"}`.

- [ ] **Step 3: Bater num endpoint que use o env (se houver Mongo rodando)**

Run: `curl -i -H "env: dev" http://localhost:3000/people`
Expected: 200 com lista (vazia ou populada) — comprova que o header `env` chega no repository via ctx.

Se não houver Mongo local subido, pular esse step — typecheck + unit tests já cobrem que o ctx flui corretamente nas assinaturas.

- [ ] **Step 4: Derrubar o servidor (Ctrl+C)**

---

## Próximos passos (fora do escopo desta spec)

Quando este refactor mergear, os campos adicionais podem ser adicionados em uma só task cada — basta estender a interface e popular no builder:

1. **`traceId`** — `crypto.randomUUID()` no builder, propaga automaticamente.
2. **`userId`** — extrair do JWT no auth middleware, popular antes do controller rodar (provavelmente via decorator do Fastify ou hook `preHandler`).
3. **`logger`** — instanciar logger filho com `{ traceId, userId }` no builder; substituir `console.log` no projeto inteiro depois.

Cada um desses é uma PR pequena depois que a fundação estiver no main.

---

## Self-Review

- **Spec coverage:** Cobre interface, builder com TDD, e migração mecânica das 4 camadas. Não esqueci de deletar `GetEnv` (único consumer migrou). ✅
- **Placeholder scan:** Cada step tem código exato ou comando exato. Sem "TBD". ✅
- **Type consistency:** `RequestContext`, `buildRequestContext`, `ctx: RequestContext` usados consistentemente em todos os arquivos. ✅
