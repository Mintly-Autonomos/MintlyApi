# Cobertura 90% — Pirâmide de Testes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir a cobertura da MintlyApi do baseline atual (~51% lines / 36% branches) para **90% nas 4 métricas (lines, statements, branches, functions)** com pirâmide explícita: unit (rápido, puro), integration (in-memory Mongo), E2E (Atlas, só local). Threshold do vitest aplicado no `npm run test:ci` — falha o CI se cair abaixo.

**Architecture:**
- **Unit (`*.spec.ts`)** — co-localizados ao código, puros, sem I/O. Mock onde necessário.
- **Integration (`*.int.spec.ts`)** — sobem in-memory Mongo via `mongodb-memory-server`, exercitam o stack real `route → controller → usecase → repository` via `fastify.inject` (sem socket HTTP).
- **E2E (`*.e2e.spec.ts`)** — bootam servidor real (`fastify.listen`) contra **Atlas com env=e2e** (DB isolado). Rodam só local, via `npm run test:e2e`. CI roda só unit + integration.

Coverage threshold é aplicado **só no `npm run test:ci`** (unit + integration). E2E não contribui pro coverage report (rodam contra real Atlas, lento, separado).

**Tech Stack:** vitest 4, @vitest/coverage-v8, mongodb-memory-server, fastify 5

---

## File Structure

**Novos arquivos:**
- `tests/helpers/in-memory-mongo.ts` — boot/teardown de Mongo in-memory + injeção no `MongoDBConnection` singleton
- `tests/helpers/build-test-server.ts` — helper que constrói server + conecta in-memory Mongo
- `src/core/builders/response-builder/response-builder.spec.ts` — unit
- `src/core/errors/core/not-found-error.spec.ts` — unit
- `src/core/errors/core/unsupported-query-kind-error.spec.ts` — unit
- `src/infrastructure/server/build-server.int.spec.ts` — integration (error handler caminhos 400/404/500)
- `src/app/person/person-routes.int.spec.ts` — integration (CRUD completo via fastify.inject)
- `src/core/crud/mongodb-crud-repository.int.spec.ts` — integration (query() com mongo real, completa o que os unit tests com mocks deixaram fora)
- `tests/e2e/person.e2e.spec.ts` — E2E (POST → GET list → GET by id → DELETE) contra Atlas
- `tests/e2e/vitest.e2e.config.ts` — vitest config específica de E2E
- `.env.e2e.example` — template de env vars pra E2E
- `vitest.config.ts` (modificado) — projects (unit, int), coverage com threshold 90%

**Arquivos modificados:**
- `package.json` — novos scripts (`test:unit`, `test:int`, `test:e2e`, `test:ci`, `test:cov`), dep `mongodb-memory-server`
- `vitest.config.ts` — projects + coverage thresholds
- `.gitignore` — `.env.e2e`

---

## Decisões de design (importantes)

**1. Por que pirâmide explícita (unit / int / e2e) e não só "tests"?**

Vc precisa de feedback rápido em desenvolvimento. Unit rodam em <1s, integration em ~5s (in-memory boot tem overhead), E2E em dezenas de segundos (rede pro Atlas). Separar permite `npm run test:unit` no watch e deixar `test:int` pra antes do commit.

**2. Por que `fastify.inject` em vez de servidor real + HTTP client em integration?**

`fastify.inject` simula o request inteiro sem abrir socket — mais rápido, deterministicamente, e suficiente pra testar TODOS os layers (controller → usecase → repo). Reservamos servidor + HTTP real só pra E2E, onde queremos validar bootstrap, CORS, swagger, etc.

**3. Por que E2E hits Atlas e não in-memory?**

E2E pra esse projeto é "tudo plugado de verdade". In-memory Mongo é uma simulação ótima do driver, mas valida pouco do que muda em produção (auth, latência, hosts). Como vc não tá em produção, faz sentido bater no Atlas real com um DB isolado (`env=e2e`).

**4. Por que threshold falha o CI?**

Sem o threshold, cobertura cai silenciosamente conforme features novas entram sem testes. Threshold transforma "queremos 90%" em invariante checada por commit.

---

## Tasks

### Task 1: Configurar Vitest projects + coverage threshold

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json` (scripts)
- Create: `.gitignore` (adicionar `.env.e2e`)

- [ ] **Step 1: Reescrever `vitest.config.ts`**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'threads',
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int.spec.ts', 'src/**/*.e2e.spec.ts', 'node_modules/**', 'dist/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.spec.ts'],
          exclude: ['node_modules/**', 'dist/**'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.int.spec.ts',
        'src/**/*.e2e.spec.ts',
        'src/server.ts',
        'src/infrastructure/server/start-server.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 90,
        functions: 90,
      },
    },
  },
})
```

Notas:
- Vitest 4 `projects:` substitui o legado `workspace`/`workspaces`. Mantém um único comando rodando ambos os projetos.
- `server.ts` e `start-server.ts` excluídos do coverage: são entrypoints I/O (process.exit, mongo.connect), exercitados implicitamente pelo E2E e estão fora do escopo de unit/int. Cobertura desses dois inflaria/distorceria as métricas.

- [ ] **Step 2: Atualizar npm scripts em `package.json`**

Substituir:
```json
"test": "vitest",
"test:ci": "vitest --run",
```

Por:
```json
"test": "vitest",
"test:unit": "vitest --project unit",
"test:int": "vitest --project integration",
"test:cov": "vitest --run --coverage",
"test:ci": "vitest --run --coverage",
"test:e2e": "vitest --run --config tests/e2e/vitest.e2e.config.ts"
```

- [ ] **Step 3: Adicionar `.env.e2e` ao `.gitignore`**

```
.env
.env.e2e

node_modules/

yarn.lock
dist/
artifacts/
```

- [ ] **Step 4: Validar que o setup atual ainda passa (mesmo sem nada novo, deve rodar os specs existentes)**

Run: `npm run test:unit`
Expected: PASS — 9 testes existentes rodam no project "unit"

Run: `npm run test:int`
Expected: PASS — 0 testes (nenhum `.int.spec.ts` ainda)

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json .gitignore
git commit -m "feat(tests): configurar vitest projects (unit/int) + coverage threshold 90%"
```

---

### Task 2: Helper de Mongo in-memory + test server

**Files:**
- Create: `tests/helpers/in-memory-mongo.ts`
- Create: `tests/helpers/build-test-server.ts`

- [ ] **Step 1: Instalar `mongodb-memory-server`**

Run: `npm install -D mongodb-memory-server`
Expected: dep adicionada em devDependencies.

- [ ] **Step 2: Criar o helper de in-memory Mongo**

```ts
// tests/helpers/in-memory-mongo.ts
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'

let memoryServer: MongoMemoryServer | undefined
let client: MongoClient | undefined

/**
 * Boota um Mongo in-memory e injeta o client no singleton MongoDBConnection.
 * Use no beforeAll do suite de integration.
 */
export async function startInMemoryMongo (): Promise<void> {
  memoryServer = await MongoMemoryServer.create()
  const uri = memoryServer.getUri()
  client = new MongoClient(uri)
  await client.connect()

  // Injeta o client no singleton sem chamar .connect() de novo
  const instance = MongoDBConnection.getInstance() as any
  instance.client = client
}

/**
 * Limpa todas as collections de TODOS os databases já tocados.
 * Use no beforeEach pra isolar suites.
 */
export async function clearAllDatabases (): Promise<void> {
  if (!client) throw new Error('In-memory Mongo não foi iniciado')

  const admin = client.db().admin()
  const { databases } = await admin.listDatabases()
  for (const dbInfo of databases) {
    if (['admin', 'local', 'config'].includes(dbInfo.name)) continue
    const db = client.db(dbInfo.name)
    const collections = await db.collections()
    await Promise.all(collections.map(c => c.deleteMany({})))
  }
}

/**
 * Derruba o in-memory Mongo. Use no afterAll.
 */
export async function stopInMemoryMongo (): Promise<void> {
  await client?.close()
  await memoryServer?.stop()
  client = undefined
  memoryServer = undefined

  const instance = MongoDBConnection.getInstance() as any
  instance.client = null
  instance.db = null
}
```

- [ ] **Step 3: Criar helper de test server**

```ts
// tests/helpers/build-test-server.ts
import { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'

/**
 * Constrói um Fastify server pronto pra fastify.inject().
 * Não conecta no Mongo — use startInMemoryMongo() separado no beforeAll.
 */
export async function buildTestServer (): Promise<FastifyInstance> {
  const server = await buildServer()
  await server.ready()
  return server
}
```

- [ ] **Step 4: Validar que os helpers compilam (typecheck)**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/helpers package.json package-lock.json
git commit -m "feat(tests): helpers de in-memory Mongo + test server"
```

---

### Task 3: Unit tests do ResponseBuilder

**Files:**
- Create: `src/core/builders/response-builder/response-builder.spec.ts`

- [ ] **Step 1: Inspecionar o ResponseBuilder pra entender a API exata**

Run: `cat src/core/builders/response-builder/response-builder.ts`

Identificar os métodos públicos: `payload()`, `pagination()`, `status()`, `build()`. Confirmar a forma do retorno (provavelmente `ResponseDto<T>` da mintly-lib).

- [ ] **Step 2: Escrever os testes**

Adaptar conforme a forma real do builder, mas o gabarito abaixo cobre os casos típicos:

```ts
// src/core/builders/response-builder/response-builder.spec.ts
import { describe, it, expect } from 'vitest'
import { ResponseBuilder } from './response-builder'

describe('ResponseBuilder', () => {
  it('embrulha payload em ResponseDto', () => {
    const result = new ResponseBuilder()
      .payload({ id: '1', name: 'Ada' })
      .build()
    expect(result).toEqual({ payload: { id: '1', name: 'Ada' } })
  })

  it('adiciona pagination quando fornecida', () => {
    const result = new ResponseBuilder()
      .payload([{ id: '1' }])
      .pagination({ page: 1, size: 10, totalItems: 1, totalPages: 1 })
      .build()
    expect(result).toEqual({
      payload: [{ id: '1' }],
      pagination: { page: 1, size: 10, totalItems: 1, totalPages: 1 },
    })
  })

  it('build sem payload retorna objeto vazio ou só pagination', () => {
    const empty = new ResponseBuilder().build()
    expect(empty).toEqual({})
  })

  it('chainable: cada setter retorna this', () => {
    const builder = new ResponseBuilder()
    expect(builder.payload({})).toBe(builder)
    expect(builder.pagination({ page: 1, size: 10, totalItems: 0, totalPages: 0 })).toBe(builder)
  })
})
```

Se `status()` afetar de fato a resposta (e não só o reply), adicionar caso. Se for um no-op que só seta um campo interno, testar que `build()` reflete isso.

- [ ] **Step 3: Rodar**

Run: `npm run test:unit -- response-builder.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/builders/response-builder/response-builder.spec.ts
git commit -m "test(core): unit tests do ResponseBuilder"
```

---

### Task 4: Unit tests dos erros

**Files:**
- Create: `src/core/errors/core/not-found-error.spec.ts`
- Create: `src/core/errors/core/unsupported-query-kind-error.spec.ts`

- [ ] **Step 1: NotFoundError**

```ts
// src/core/errors/core/not-found-error.spec.ts
import { describe, it, expect } from 'vitest'
import { NotFoundError } from './not-found-error'
import { Resource } from '../../types/resource'
import { BaseError } from './base-error'

describe('NotFoundError', () => {
  it('estende BaseError com statusCode 404', () => {
    const err = new NotFoundError(Resource.Person, '123')
    expect(err).toBeInstanceOf(BaseError)
    expect(err.statusCode).toBe(404)
  })

  it('mensagem inclui resource e id', () => {
    const err = new NotFoundError(Resource.Person, 'abc-123')
    expect(err.message).toContain('Person')
    expect(err.apiMessage).toContain('abc-123')
  })

  it('code é APP-0001', () => {
    const err = new NotFoundError(Resource.Person, '1')
    expect(err.code).toBe('APP-0001')
  })
})
```

- [ ] **Step 2: UnsupportedQueryKindError**

```ts
// src/core/errors/core/unsupported-query-kind-error.spec.ts
import { describe, it, expect } from 'vitest'
import { UnsupportedQueryKindError } from './unsupported-query-kind-error'
import { BaseError } from './base-error'

describe('UnsupportedQueryKindError', () => {
  it('estende BaseError com statusCode 501', () => {
    const err = new UnsupportedQueryKindError('sql:select', 'mongodb')
    expect(err).toBeInstanceOf(BaseError)
    expect(err.statusCode).toBe(501)
  })

  it('mensagem inclui kind e backend', () => {
    const err = new UnsupportedQueryKindError('sql:select', 'mongodb')
    expect(err.message).toContain('sql:select')
    expect(err.message).toContain('mongodb')
  })

  it('code é APP-0002', () => {
    const err = new UnsupportedQueryKindError('sql:select', 'mongodb')
    expect(err.code).toBe('APP-0002')
  })
})
```

- [ ] **Step 3: Rodar e commitar**

```bash
npm run test:unit
git add src/core/errors/core/*.spec.ts
git commit -m "test(core): unit tests dos erros NotFound e UnsupportedQueryKind"
```

---

### Task 5: Integration test do error handler do build-server

**Files:**
- Create: `src/infrastructure/server/build-server.int.spec.ts`

- [ ] **Step 1: Escrever o teste**

O error handler tem 3 caminhos: `BaseError` → status do erro; `SapphireValidationError` → 400 com fieldErrors; fallback → 500. Vamos forçar cada um via uma rota injetada de teste.

```ts
// src/infrastructure/server/build-server.int.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { buildServer } from './build-server'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'

describe('build-server error handler', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    const fastify = Fastify()
    fastify.get('/throw/not-found', () => {
      throw new NotFoundError(Resource.Person, 'x')
    })
    fastify.get('/throw/validation', () => {
      throw new SapphireValidationError([
        { path: ['name'], code: 'required', message: 'Nome é obrigatório' },
      ])
    })
    fastify.get('/throw/generic', () => {
      throw new Error('boom')
    })
    server = await buildServer(fastify)
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  it('responde com statusCode do BaseError', async () => {
    const response = await server.inject({ method: 'GET', url: '/throw/not-found' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'APP-0001' })
  })

  it('responde 400 com fieldErrors pra SapphireValidationError', async () => {
    const response = await server.inject({ method: 'GET', url: '/throw/validation' })
    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.details).toHaveProperty('name')
  })

  it('responde 500 pra Error genérico', async () => {
    const response = await server.inject({ method: 'GET', url: '/throw/generic' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
  })
})
```

- [ ] **Step 2: Rodar e commitar**

```bash
npm run test:int
git add src/infrastructure/server/build-server.int.spec.ts
git commit -m "test(server): integration do error handler (404/400/500)"
```

---

### Task 6: Integration test do PersonRoutes com in-memory Mongo

**Files:**
- Create: `src/app/person/person-routes.int.spec.ts`

- [ ] **Step 1: Escrever o teste cobrindo CRUD completo via fastify.inject**

```ts
// src/app/person/person-routes.int.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildTestServer } from '../../../tests/helpers/build-test-server'
import { startInMemoryMongo, stopInMemoryMongo, clearAllDatabases } from '../../../tests/helpers/in-memory-mongo'

describe('Person routes (integration)', () => {
  let server: Awaited<ReturnType<typeof buildTestServer>>
  const headers = { env: 'int-test' }

  beforeAll(async () => {
    await startInMemoryMongo()
    server = await buildTestServer()
  })

  afterAll(async () => {
    await server.close()
    await stopInMemoryMongo()
  })

  beforeEach(async () => {
    await clearAllDatabases()
  })

  it('POST /people cria e devolve a pessoa com _id', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/people/',
      headers,
      payload: { name: 'Ada', age: 30 },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.payload).toMatchObject({ name: 'Ada', age: 30 })
    expect(body.payload._id).toBeDefined()
  })

  it('POST /people com body inválido devolve 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/people/',
      headers,
      payload: { name: 'Ada' }, // age faltando
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
  })

  it('GET /people/:id devolve a pessoa criada', async () => {
    const created = await server.inject({
      method: 'POST', url: '/people/', headers,
      payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'GET', url: `/people/${id}`, headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().payload).toMatchObject({ name: 'Ada', age: 30 })
  })

  it('GET /people/:id com id inexistente devolve 404', async () => {
    // Mongo ObjectId válido mas que não existe
    const response = await server.inject({
      method: 'GET', url: '/people/507f1f77bcf86cd799439011', headers,
    })
    expect(response.statusCode).toBe(404)
  })

  it('GET /people lista todas as pessoas com paginação', async () => {
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'A', age: 1 } })
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'B', age: 2 } })

    const response = await server.inject({ method: 'GET', url: '/people/', headers })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.payload).toHaveLength(2)
    expect(body.pagination).toMatchObject({ totalItems: 2, totalPages: 1 })
  })

  it('GET /people?isMultipleResponse=false&name=A faz find single', async () => {
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'A', age: 1 } })
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'B', age: 2 } })

    const response = await server.inject({
      method: 'GET',
      url: '/people/?name=A',
      headers,
    })
    expect(response.statusCode).toBe(200)
  })

  it('PATCH /people/:id atualiza a pessoa', async () => {
    const created = await server.inject({
      method: 'POST', url: '/people/', headers, payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'PATCH', url: `/people/${id}`, headers,
      payload: { name: 'Ada Lovelace', age: 36 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().payload).toMatchObject({ name: 'Ada Lovelace', age: 36 })
  })

  it('DELETE /people/:id remove e devolve 204', async () => {
    const created = await server.inject({
      method: 'POST', url: '/people/', headers, payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'DELETE', url: `/people/${id}`, headers,
    })
    expect(response.statusCode).toBe(204)
  })
})
```

- [ ] **Step 2: Rodar**

Run: `npm run test:int`
Expected: PASS (todos os ~8 casos)

Se algum caso quebrar, geralmente é (a) o body do POST esperando `id` (ajustar cast ou usar `Omit`) ou (b) timing do mongodb-memory-server (hooks com mais timeout). Ajustar conforme necessário.

- [ ] **Step 3: Commit**

```bash
git add src/app/person/person-routes.int.spec.ts
git commit -m "test(person): integration do CRUD completo via fastify.inject + in-memory Mongo"
```

---

### Task 7: Integration test do query() no Mongo real

**Files:**
- Create: `src/core/crud/mongodb-crud-repository.int.spec.ts`

- [ ] **Step 1: Escrever o teste**

Os unit tests com mock cobrem que o switch chama o método certo. O integration valida que aggregate e find devolvem dado real.

```ts
// src/core/crud/mongodb-crud-repository.int.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongodbCrudRepository } from './mongodb-crud-repository'
import { startInMemoryMongo, stopInMemoryMongo, clearAllDatabases } from '../../../tests/helpers/in-memory-mongo'
import type { RequestContext } from '../context/request-context'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'

describe('MongodbCrudRepository (integration)', () => {
  const ctx: RequestContext = { env: 'int-test-query' }
  let repo: MongodbCrudRepository<{ name: string, age: number }, string>

  beforeAll(async () => {
    await startInMemoryMongo()
    repo = new MongodbCrudRepository('people')
  })

  afterAll(async () => {
    await stopInMemoryMongo()
  })

  beforeEach(async () => {
    await clearAllDatabases()
  })

  it('query mongo:pipeline executa aggregation', async () => {
    await repo.insert({ name: 'Ada', age: 30 } as any, ctx)
    await repo.insert({ name: 'Bob', age: 40 } as any, ctx)

    const result = await repo.query<any[]>(
      { kind: 'mongo:pipeline', pipeline: [{ $match: { age: { $gte: 35 } } }] },
      ctx,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Bob' })
  })

  it('query mongo:filter executa find', async () => {
    await repo.insert({ name: 'Ada', age: 30 } as any, ctx)
    await repo.insert({ name: 'Bob', age: 40 } as any, ctx)

    const result = await repo.query<any[]>(
      { kind: 'mongo:filter', filter: { name: 'Ada' } },
      ctx,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Ada' })
  })

  it('query sql:select lança UnsupportedQueryKindError', async () => {
    await expect(
      repo.query({ kind: 'sql:select', sql: 'SELECT 1' }, ctx),
    ).rejects.toBeInstanceOf(UnsupportedQueryKindError)
  })
})
```

- [ ] **Step 2: Rodar e commitar**

```bash
npm run test:int
git add src/core/crud/mongodb-crud-repository.int.spec.ts
git commit -m "test(core): integration do query() do Mongo (pipeline e filter)"
```

---

### Task 8: Configuração de E2E

**Files:**
- Create: `tests/e2e/vitest.e2e.config.ts`
- Create: `.env.e2e.example`

- [ ] **Step 1: Vitest config dedicada de E2E**

```ts
// tests/e2e/vitest.e2e.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'threads',
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
})
```

- [ ] **Step 2: Template de env**

```
# .env.e2e.example
# Copie pra .env.e2e e preencha com o URI do Atlas.
# E2E vai usar o header env=e2e pra rotear pro database "e2e" no cluster.
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/
PORT=3001
API_URL=http://localhost:3001
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/vitest.e2e.config.ts .env.e2e.example
git commit -m "feat(tests): configurar runner de E2E + template .env.e2e"
```

---

### Task 9: E2E happy path do Person contra Atlas

**Files:**
- Create: `tests/e2e/person.e2e.spec.ts`

- [ ] **Step 1: Criar o `.env.e2e` local (não commitado)**

Pelo engenheiro: copiar `.env.e2e.example` pra `.env.e2e` e preencher com o URI do Atlas (mesmo URI do .env normal serve, contanto que aponte pro mesmo cluster). Confirmar que o cluster tem permissão pra criar database `e2e`.

- [ ] **Step 2: Escrever o teste E2E**

```ts
// tests/e2e/person.e2e.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'
import type { FastifyInstance } from 'fastify'

dotenv.config({ path: '.env.e2e' })

describe('Person E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  const headers = { env: 'e2e' }

  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('Defina MONGODB_URI no .env.e2e — copie de .env.e2e.example')
    }
    server = await buildServer()
    await mongoConnection.connect()
    await server.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3001) })
    const address = server.server.address()
    if (typeof address === 'string' || address === null) throw new Error('servidor sem endereço')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    // Cleanup: dropa o database e2e inteiro
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db('e2e').dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  it('fluxo completo: POST → GET list → GET by id → DELETE', async () => {
    // POST
    const postRes = await fetch(`${baseUrl}/people/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'E2E Ada', age: 42 }),
    })
    expect(postRes.status).toBe(200)
    const created = await postRes.json() as any
    const id = created.payload._id
    expect(id).toBeDefined()

    // GET list
    const listRes = await fetch(`${baseUrl}/people/`, { headers })
    expect(listRes.status).toBe(200)
    const list = await listRes.json() as any
    expect(list.payload.length).toBeGreaterThanOrEqual(1)

    // GET by id
    const getRes = await fetch(`${baseUrl}/people/${id}`, { headers })
    expect(getRes.status).toBe(200)
    const single = await getRes.json() as any
    expect(single.payload).toMatchObject({ name: 'E2E Ada', age: 42 })

    // DELETE
    const delRes = await fetch(`${baseUrl}/people/${id}`, { method: 'DELETE', headers })
    expect(delRes.status).toBe(204)

    // GET by id após delete deve dar 404
    const after = await fetch(`${baseUrl}/people/${id}`, { headers })
    expect(after.status).toBe(404)
  })
})
```

- [ ] **Step 3: Rodar E2E manualmente**

Run: `npm run test:e2e`
Expected: PASS — server boota, conecta no Atlas, suite roda, dropa database "e2e" no final.

Se falhar com timeout, é provável que o cluster esteja com cold start. Re-rodar.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/person.e2e.spec.ts
git commit -m "test(e2e): fluxo completo de Person contra Atlas (env=e2e)"
```

---

### Task 10: Fechar o gap pra 90% (iterativo)

**Files:** depende do que estiver descoberto

- [ ] **Step 1: Rodar coverage**

Run: `npm run test:ci`
Expected: relatório de coverage. Se threshold falhar, vitest sai com erro listando arquivos abaixo de 90% — esses são alvos.

- [ ] **Step 2: Listar gaps**

Tipicamente vão sobrar:
- `mongodb-connection.ts` — métodos não exercitados (setupGracefulShutdown, etc.). Decidir: cobrir com test ou excluir do coverage.
- `crud-controller.ts` query() — não tem rota HTTP exposta usando query(). Decidir: testar via instanciação direta + mock ou excluir.
- Branches específicas (default values em destructuring, etc.).

- [ ] **Step 3: Adicionar testes ou exclusões pontuais**

Pra cada gap:
- Se for código vivo: escrever unit/int test específico.
- Se for infra (graceful shutdown, etc.): adicionar ao `coverage.exclude` no `vitest.config.ts` com comentário justificando.

- [ ] **Step 4: Re-rodar até verde**

Run: `npm run test:ci`
Repetir Step 3 + 4 até o threshold passar.

- [ ] **Step 5: Commit**

```bash
git add <arquivos>
git commit -m "test: cobrir gaps remanescentes ate 90%"
```

---

### Task 11: Push + PR

**Files:** nenhum

- [ ] **Step 1: Verificação final**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: tudo PASS, coverage ≥90% em todas as 4 métricas.

- [ ] **Step 2: Smoke E2E final**

Run: `npm run test:e2e`
Expected: PASS contra Atlas, database e2e dropado.

- [ ] **Step 3: Push e PR**

```bash
git push -u origin test/20260531/cobertura-90
gh pr create --base staging --head test/20260531/cobertura-90 \
  --title "test: pirâmide unit/integration/E2E com cobertura 90%" \
  --body "..."
```

PR body cobrindo: scripts novos, estratégia in-memory vs Atlas, threshold no CI, instruções pra rodar E2E local.

---

## Próximos passos (fora do escopo desta spec)

1. **CI rodando `test:ci`** — confirmar que o pipeline executa o coverage e falha se cair abaixo de 90%.
2. **Badge de coverage no README** — gerar a partir do `json-summary` reporter já configurado.
3. **E2E em PR check separado** — quando time crescer, considerar um workflow opcional `e2e-on-demand` que usa secret só em main.
4. **Snapshot tests pro swagger** — garantir que o documento OpenAPI não regride.

---

## Self-Review

- **Spec coverage:** Setup + helpers + ResponseBuilder + erros + error handler + integration CRUD + integration query Mongo + E2E config + E2E happy path + gap closing + PR. ✅
- **Placeholder scan:** Cada step tem código exato ou comando exato. Onde a forma exata do ResponseBuilder é incerta (Task 3 Step 1 pede inspeção), há orientação explícita. Task 10 é deliberadamente iterativa porque depende do que sobrar no relatório de coverage. ✅
- **Type consistency:** `RequestContext`, `Query`, `UnsupportedQueryKindError`, headers `env`, helpers `startInMemoryMongo`/`stopInMemoryMongo`/`clearAllDatabases` consistentes em todas as referências. ✅
