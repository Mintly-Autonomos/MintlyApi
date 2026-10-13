# Fatia 5 — Subcategoria e canal (M3, M4)

Subcategoria embutida na categoria · `channel` na movimentação · fundação das fatias 6 e 7 (Custos & Despesas)

Roteiro geral: `specs/modulos-novos/20260929/design.md` (M3, M4). Este documento detalha a fatia.

---

## Contexto

A tela de Custos & Despesas (prints `095700` a `095828`) abre uma categoria em subitens — CMV/Insumos →
Frango, Óleo, Embalagens, Molhos, Bebidas — e filtra por Geral / Salão / Delivery. O modelo não tem
nem um nem outro. Esta fatia é só fundação: nenhum relatório novo; as fatias 6 e 7 consomem.

Achado que molda o desenho: editar uma categoria de sistema (as 6 do onboarding) dá 409, e o exemplo
principal das prints — CMV/Insumos — é de sistema.

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| S1 | Subcategoria embutida na categoria (`subcategories[]`) e extended reference na movimentação | D4 do design: poucas por categoria, lidas junto, sem `$lookup` |
| S2 | O sub-recurso funciona em **qualquer** categoria, inclusive de sistema; a trava de edição segue só para os campos da categoria | Subcategoria é detalhe do dono; sem isso, detalhar insumos é impossível |
| S3 | Subcategoria **opcional sempre** no lançamento | Cadastro gradual, sem quebrar antigos e importações; o relatório mostra "Sem subitem" |
| S4 | Só inativação, sem delete | Mesmo padrão das categorias; lançamentos antigos seguem apontando |
| S5 | Canal efetivo resolvido **na leitura** por função pura; `channel` só gravado quando o dono informa | Sem backfill; distingue escolha do dono de padrão; regra muda num lugar só |
| S6 | Renomear a subcategoria não reescreve lançamentos (cópia do nome); relatórios agrupam por `_id` e mostram o nome atual | Mesmo padrão de `account`/`category` |

**Alternativas recusadas:** subcategoria em coleção própria (`$lookup` em todo relatório de custo);
obrigatória quando existir (fricção e lançamentos antigos "irregulares"); canal carimbado no registro
+ backfill (mais um comando, perde a distinção escolha × padrão); canal padrão na conta financeira
(mudança de modelo maior, sem demanda).

---

## Contrato (MintlyLib)

### Categoria

```ts
export const subcategorySchema = s.object({
  _id: s.string(),
  name: s.string().max(60),
  status: s.type().enum(RecordStatus),
})

// baseCategorySchema ganha:
subcategories: s.array(subcategorySchema).default([])

export const subcategoryInsertSchema = s.object({ name: s.string().max(60) })
export const subcategoryUpdateSchema = s.object({ name: s.string().max(60) }).partial()
```

`financialCategoryInsertSchema` e `financialCategoryUpdateSchema` **não** aceitam `subcategories`
(objetos estritos — a lista só muda pelo sub-recurso).

### Movimentação

```ts
export enum MovementChannel { DineIn = 'dineIn', Delivery = 'delivery', Shared = 'shared' }

// financialMovementSchema (base) ganha:
channel: s.type().enum(MovementChannel).optional(),
subcategory: s.object({ _id: s.string(), name: s.string() }).optional(),

// registerMovementSchema / RegisterMovementRequest: + subcategoryId?: string, channel?: MovementChannel
// updateMovementSchema / UpdateMovementRequest:     + subcategoryId?: string | null, channel?: MovementChannel | null
```

`null` na edição limpa o campo (mesmo padrão do `dueDate`).

### Client

`FinancialCategoryClient`: `addSubcategory(categoryId, { name }, headers)`,
`updateSubcategory(categoryId, subcategoryId, { name }, headers)`,
`inactivateSubcategory(categoryId, subcategoryId, headers)`,
`reactivateSubcategory(categoryId, subcategoryId, headers)`.

Aditivo: `feat` sem `!`.

---

## API

### Sub-recurso de subcategorias

| Rota | Efeito |
|---|---|
| `POST /financial-categories/:id/subcategories` `{ name }` | cria `{ _id, name, status: active }`; **201** com a subcategoria |
| `PATCH /financial-categories/:id/subcategories/:subId` `{ name }` | renomeia; 200 com a subcategoria |
| `PATCH /financial-categories/:id/subcategories/:subId/inactivate` | status `inactive`; 200 |
| `PATCH /financial-categories/:id/subcategories/:subId/reactivate` | status `active`; 200 |

Regras (puras em `src/app/financial-category/subcategory-rules.ts`):

- Categoria do restaurante (404 se não; inclusive de outro tenant); subcategoria inexistente → 404.
- Nome aparado; vazio → 400; > 60 caracteres → 400 (schema).
- Único na categoria, sem diferenciar maiúsculas, **contando inativas** → 409.
- Cada mudança: `history` da categoria (`subcategory:add`, `subcategory:rename`, `subcategory:inactivate`,
  `subcategory:reactivate`, `detail` com o nome) + `audit.updatedAt/updatedBy`.
- Funciona em categorias de sistema (S2); inativar a categoria não mexe nas subcategorias.

### Registro de movimentação

- `subcategoryId` informado: tem que existir na categoria escolhida **e** estar ativa; senão **400**
  (`ValidationError`, `APP-0005`) com a mensagem do caso. Grava `subcategory: { _id, name }`.
- `channel` informado: gravado (enum validado pelo schema).

### Edição de movimentação

Regra pura em `movement-rules.ts`:

| Situação | Resultado |
|---|---|
| categoria trocada, sem `subcategoryId` | subcategoria removida (era da anterior) |
| `subcategoryId: null` | removida |
| `subcategoryId` igual ao gravado | mantida, mesmo inativa |
| `subcategoryId` novo | precisa existir na categoria final e estar ativa; senão 400 |
| nada sobre subcategoria, categoria mantida | mantida |
| `channel: null` / valor / ausente | remove / grava / mantém |

### Canal efetivo

`src/app/reports/shared/channel.ts`:

```ts
effectiveChannel({ direction, account: { type }, channel? }): MovementChannel
// channel informado → ele; entrada em conta platform → delivery; outra entrada → dineIn; saída → shared
```

Sem consumidor nesta fatia — contrato das fatias 6 e 7, entregue testado.

Sem índice novo, sem comando no ambiente.

---

## Testes

**Unitário** — `subcategory-rules` (nome aparado, vazio, unicidade case-insensitive com inativas, busca
por `_id`); `effectiveChannel` (4 ramos); regra de subcategoria na edição (todas as linhas da tabela).

**Integração** — sub-recurso (201 em categoria de sistema, 409 repetido, 400 vazio, renomear,
inativar/reativar com `history`, 404 de outro tenant e de subcategoria inexistente); registro com
subcategoria e canal; 400 para subcategoria de outra categoria ou inativa; edição trocando categoria,
`subcategoryId: null`, `channel: null`; renomear não altera lançamento gravado; categoria antiga sem
`subcategories` lê `[]`; cadastro de categoria recusa `subcategories`.

**E2E** — criar subcategoria em CMV/Insumos, lançar despesa com ela e `channel: delivery`, ler por
HTTP real.

**Insomnia** — as 4 rotas do sub-recurso.

Threshold de 90% nas quatro métricas.

---

## Entrega

1. **MintlyLib** `feat/20261013/subcategoria-canal` a partir de `staging` — `feat` sem `!`.
2. **MintlyApi** `feat/20261013/subcategoria-canal` a partir de `staging`.

Nenhum comando novo no ambiente.

---

## Fora de escopo

- Relatórios que usam subcategoria e canal — fatias 6 e 7.
- Rateio de despesa compartilhada entre canais (N3).
- Canal padrão por conta financeira.
- Import em massa com subcategoria (avulso).

---

## Self-review

- **Placeholders:** nenhum.
- **Consistência:** S2 (sistema aceita subcategoria) não conflita com a trava de edição da categoria —
  o sub-recurso não passa pelo `PATCH /financial-categories/:id`.
- **Ambiguidade:** "canal efetivo" tem uma regra só (`effectiveChannel`); o caso "subcategoria inativa
  já gravada" está explícito na tabela da edição.
- **Escopo:** dois campos na movimentação, um subdocumento na categoria, quatro rotas — cabe num plano.
