# Fastify Route Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar todos os `request: any` nas rotas Fastify, tipando body, querystring, params e headers com os tipos genéricos nativos do Fastify 5 + os types já exportados pela `mintly-lib` (`Person`, `FindAllRequestDto`, `Headers`).

**Architecture:** Fastify 5 já traz `FastifyRequest<{ Body, Querystring, Params, Headers }>` no core — não precisa de nenhum pacote adicional. A estratégia é declarar o "shape" de cada rota numa interface (`PostPersonRoute`, `GetPersonByIdRoute`, etc.) e usar essa interface como generic do handler. Isso mantém os arquivos de rota legíveis e dá autocomplete + checagem em tempo de compilação, casando com a validação runtime do sapphire que já existe na controller.

**Tech Stack:** TypeScript 5, Fastify 5, sapphire-core, mintly-lib

---

## File Structure

**Arquivos modificados:**
- `src/app/person/person-routes.ts` — tipar os 4 handlers (POST, GET list, GET by id, DELETE), descomentar e tipar o PATCH
- `src/app/health/health-routes.ts` — já está limpo (sem `any`), só auditar pra confirmar

**Não muda:** `person-controller.ts` (assinaturas continuam aceitando `IncomingHttpHeaders`), `build-server.ts`, restante.

**Observação:** Não estamos adicionando o schema JSON do Fastify nas rotas de Person agora — isso é outra spec (alinhar sapphire ↔ swagger). Esta spec é só tipagem TS.

---

## Tasks

### Task 1: Definir os "route shapes" para o módulo Person

**Files:**
- Modify: `src/app/person/person-routes.ts`

- [ ] **Step 1: Substituir o conteúdo do arquivo pelo abaixo**

```ts
// src/app/person/person-routes.ts
import { FastifyInstance, FastifyRequest } from 'fastify'
import { Person } from 'mintly-lib'
import type { FindAllRequestDto, Headers } from 'mintly-lib'
import { PersonController } from './person-controller'

type PersonHeaders = Headers
type PersonBody = Omit<Person, 'id' | '_id'>
type PersonParams = { id: string }
type PersonListQuery = FindAllRequestDto<Person> & { isMultipleResponse?: 'true' | 'false' }

type PostPersonRequest = FastifyRequest<{ Body: PersonBody, Headers: PersonHeaders }>
type GetPersonListRequest = FastifyRequest<{ Querystring: PersonListQuery, Headers: PersonHeaders }>
type GetPersonByIdRequest = FastifyRequest<{ Params: PersonParams, Headers: PersonHeaders }>
type PatchPersonRequest = FastifyRequest<{ Params: PersonParams, Body: Partial<PersonBody>, Headers: PersonHeaders }>
type DeletePersonRequest = FastifyRequest<{ Params: PersonParams, Headers: PersonHeaders }>

export async function personRoutes (fastify: FastifyInstance) {
  const personController = new PersonController()

  fastify.post('/', (request: PostPersonRequest) => {
    return personController.insert(request.body as Person, request.headers)
  })

  fastify.get('/', (request: GetPersonListRequest) => {
    return request.query.isMultipleResponse === 'true'
      ? personController.find(request.query, request.headers)
      : personController.findAll(request.query, request.headers)
  })

  fastify.get('/:id', (request: GetPersonByIdRequest) => {
    return personController.findById(request.params.id, request.headers)
  })

  fastify.patch('/:id', (request: PatchPersonRequest) => {
    return personController.update(request.params.id, request.body as Partial<Person>, request.headers)
  })

  fastify.delete('/:id', (request: DeletePersonRequest) => {
    return personController.delete(request.params.id, request.headers)
  })
}
```

Notas pro engenheiro implementando:
- O `as Person` / `as Partial<Person>` na chamada da controller é proposital: a controller espera `T` (Person completo, com `Entity`), mas o body do POST não envia `id`. A validação real é feita pelo `personSchema.parse()` dentro da controller — esse cast aqui é só pra calar o TS na borda.
- `isMultipleResponse` vira string querystring (`'true'`/`'false'`) — não boolean — porque querystrings sempre chegam como string no Fastify default.
- `PersonHeaders = Headers` mantém compatibilidade com `IncomingHttpHeaders` esperada pela controller, já que `Headers` da mintly-lib estende um shape compatível.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — zero erros

- [ ] **Step 3: Rodar testes**

Run: `npm run test:ci`
Expected: PASS — os 2 testes existentes não dependem do shape; continuam ok.

- [ ] **Step 4: Smoke test manual**

Run: `npm run dev`
Em outro terminal:
```bash
curl -i -H "env: dev" http://localhost:3000/people
```
Expected: 200 (lista vazia ou populada). Comprova que o handler tipado continua respondendo igual.

- [ ] **Step 5: Commit**

```bash
git add src/app/person/person-routes.ts
git commit -m "feat(person): tipar handlers das rotas com generics do Fastify"
```

---

### Task 2: Auditoria das outras rotas

**Files:**
- Modify (se houver `any`): `src/app/health/health-routes.ts`

- [ ] **Step 1: Procurar `any` em rotas**

Run: `grep -rn "request: any" src/app`
Expected: zero resultados depois da Task 1

Se aparecer algum não-coberto, criar o shape correspondente seguindo o padrão da Task 1. `health-routes.ts` hoje já está sem `any` — só validar.

- [ ] **Step 2: Se nada mudou, sem commit. Se mudou, commit incremental**

```bash
git add src/app/<route>.ts
git commit -m "feat(<route>): tipar handler"
```

---

### Task 3: Lint final

**Files:** nenhum

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS — sem warnings de `no-explicit-any` introduzidos por esta mudança

- [ ] **Step 2: Build pra garantir que `tsc` emite tudo**

Run: `npm run build`
Expected: PASS

---

## Próximos passos (fora do escopo desta spec)

1. **Schema JSON nas rotas Fastify** — sincronizar `personSchema` (sapphire) com o `schema` que o Fastify usa pra OpenAPI/swagger. Hoje só `health` tem schema. Quando o `sapphire-bson` for adotado, talvez dê pra gerar o JSON schema OpenAPI a partir do `personSchema.getSchema('json-schema')`. PR separada.

2. **Tipar o body com `Omit<Person, 'id' | '_id'>` na controller também** — assim o cast em `request.body as Person` some. Requer mudança na assinatura genérica de `CrudController<T, ID>` pra ter um type separado pra "create input" e "stored entity". Refatoração maior, fica pra depois.

---

## Self-Review

- **Spec coverage:** Person routes (4 handlers ativos + 1 comentado, agora descomentado), health (auditoria), e lint final. ✅
- **Placeholder scan:** Cada step tem código exato ou comando exato. ✅
- **Type consistency:** `PersonHeaders`, `PersonBody`, `PersonParams`, `PersonListQuery` usados consistentemente nos 5 `FastifyRequest<...>`. ✅
