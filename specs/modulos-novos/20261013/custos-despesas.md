# Fatia 6 — Custos & Despesas, fatia A (nível de categoria)

`GET /reports/expenses` · "Para onde vai o seu dinheiro" · CMV, prime cost e taxa de plataforma

Roteiro geral: `specs/modulos-novos/20260929/design.md` (3.3, M2, M3, M4, M6). Este documento detalha a fatia.

---

## Contexto

A tela de Custos & Despesas (prints `095626` a `095758`) tem quatro cards no topo — total de
despesas, CMV %, prime cost % e taxa do iFood — e a lista "Para onde está indo seu dinheiro", com
uma linha por categoria, comportamento (fixo / variável / misto), variação contra o mês anterior ou
contra a média de 3 meses, alternância R$ × % da receita e os filtros Todos / Só variáveis / Só
fixos e Geral / Salão / Delivery.

Esta fatia entrega o **nível de categoria**. Subitens, anomalias ("Fique de olho", selos de alerta)
e a evolução por categoria são a fatia 7. A fundação (subcategoria e canal) veio na fatia 5.

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| E1 | Período **só mês**: `?month=AAAA-MM`, padrão o corrente, futuro → 400 | As comparações (mês anterior, média de 3 meses) e os % pressupõem mês fechado; mesmo contrato do DRE |
| E2 | **Todas as saídas entram** no total, inclusive o grupo `tax` (aparece como categoria), mais a taxa de plataforma | A tela responde "para onde vai o dinheiro"; o DRE responde "quanto sobrou" — os totais divergem por construção |
| E3 | Filtro de canal por **canal efetivo** (`effectiveChannel`, fatia 5); `shared` só entra em Geral; a resposta traz `sharedExcluded` | Sem rateio (N3) não há como dividir a despesa da casa; mostrar quanto ficou de fora evita leitura errada |
| E4 | Taxa de plataforma = **uma linha por conta de plataforma** ("Taxa iFood"), derivada de `Σ feeValue` (M6) | Igual à tela; o DRE segue com uma linha só |
| E5 | Abordagem: módulo `reports/expenses` próprio; canal efetivo calculado em TS sobre o agrupamento do Mongo | Reaproveita a regra pura da fatia 5 sem duplicá-la numa expressão de pipeline; não mexe na fatia 4 |

**Alternativas recusadas:** intervalo livre de datas (comparações perdem sentido); corte do DRE
(sumiria o DAS pago); `shared` em todos os canais (conta em dobro); filtro de canal adiado até o N3;
estender a consulta do DRE; pipeline único no Mongo.

---

## Contrato (MintlyLib)

```ts
interface ExpensesQuery {
  month?: string                     // AAAA-MM
  channel?: MovementChannel.DineIn | MovementChannel.Delivery
}

interface ExpensesReport {
  referenceMonth: string
  previousMonth: string
  channel: MovementChannel | null    // null = Geral
  revenue: { current: number; previous: number }          // receita bruta (do canal, se filtrado)
  total: { current: number; previous: number; average3: number | null; deltaPrevious: number | null; deltaAverage3: number | null }
  cmv: { amount: number; pctOfRevenue: number | null; target: { min: number; max: number } }      // 0.28 / 0.35
  primeCost: { amount: number; cmv: number; labor: number; pctOfRevenue: number | null; targetMax: number }  // 0.65
  platformFee: { amount: number; previous: number; deltaPrevious: number | null; deliveryRevenue: number; pctOfDelivery: number | null }
  byBehavior: { fixed: number; variable: number; mixed: number }
  items: ExpenseItem[]
  sharedExcluded: number | null      // só com channel: Σ saídas `shared` do mês
  history: { month: string; total: number }[]             // 6 meses, mais antigo primeiro
}

type ExpenseItemKind = 'category' | 'platformFee'

interface ExpenseItem {
  key: string                        // categoryId | 'platformFee:<accountId>'
  kind: ExpenseItemKind
  categoryId: string | null
  name: string
  behavior: CategoryBehavior         // taxa → variable
  dreGroup: DreGroup | null          // taxa → null
  amount: number
  previous: number
  average3: number | null
  deltaPrevious: number | null
  deltaAverage3: number | null
  pctOfRevenue: number | null
}
```

`ReportClient.expenses(query, headers)` → `GET /reports/expenses`. Tipos exportados pelo barrel de
reports. Aditivo: `feat` sem `!`.

O front alterna "vs. mês anterior / vs. média 3 meses", "R$ / % da receita" e "Todos / Só variáveis /
Só fixos" com o que já veio; só o canal refaz a chamada.

---

## Regras de cálculo

Puras em `src/app/reports/expenses/expenses-metrics.ts`; somas em centavos (`toCents`/`fromCents`).

| Regra | Definição |
|---|---|
| Janela | Uma consulta de M−5 a M (histórico, anterior e média saem dela) |
| Despesa | Saída com `date` no mês (competência, fuso `America/Sao_Paulo`), status ≠ `cancelled` |
| Categoria | Classificação **atual** (nome, `behavior`, `dreGroup`); reclassificar muda o passado. Categoria inexistente → nome do lançamento, `fixed`, `opex` |
| Taxa de plataforma | `Σ feeValue` das entradas, por `account._id`; nome `Taxa <nome atual da conta>` (sem a conta: nome do lançamento); `variable`, `dreGroup: null` |
| Canal | Cada linha agregada recebe `effectiveChannel({ direction, account: { type }, channel })`. Com filtro: despesa entra se o canal efetivo é o filtrado; a taxa segue o canal da entrada que a gerou; receita idem |
| `sharedExcluded` | Com filtro: Σ saídas de canal efetivo `shared` no mês. Sem filtro: `null` |
| Receita | `Σ grossValue` das entradas do mês (do canal, se filtrado) |
| `deliveryRevenue` | `Σ grossValue` das entradas de canal efetivo `delivery` (no filtro Salão, 0) |
| `pctOfDelivery` | `taxa / Σ grossValue das entradas em conta de plataforma` (do canal, se filtrado). **Decisão A (13/10/2026):** a taxa e a venda que a gerou ficam no mesmo denominador, mesmo se o dono marcou outro canal; venda própria marcada `delivery` não paga taxa e não entra |
| Média de 3 meses | Média de M−1, M−2, M−3 **a partir do mês do primeiro lançamento** do restaurante; mês sem gasto dentro disso conta 0; nenhum mês elegível → `null` |
| Variação | `(atual − base) / base`; base 0 → `null` |
| % da receita | `valor / receita`; receita 0 → `null` |
| Itens listados | Com valor > 0 no mês, no anterior **ou** na média; ordem: valor desc., depois nome |
| Total | Σ itens (categorias + taxas). Anterior e histórico pela mesma regra, no mesmo canal |
| CMV / prime cost | CMV = Σ itens `dreGroup: cmv`; prime cost = CMV + Σ `labor` |
| `byBehavior` | Σ por comportamento, **misto separado** (não vira fixo como no ponto de equilíbrio) |
| Metas | CMV 28–35%, prime cost ≤ 65% — constantes com a origem (MIN-84) comentada |

Arredondamento: valores em reais com 2 casas (centavos); percentuais e variações sem arredondar
(o front formata).

---

## API

```
src/app/reports/expenses/
  expenses-repository.ts     somas por mês × direção × categoria × canal gravado × conta (tipo, id, nome);
                             nomes atuais de categorias e contas
  expenses-metrics.ts        regras puras; computeExpenses(input) → ExpensesReport
  expenses-scenario.ts       cenário conferido à mão (unitário + integração)
  use-cases/expenses.query.ts
  expenses-controller.ts
  expenses-routes.ts         GET /reports/expenses
```

Mês do primeiro lançamento: `TaxRepository.firstMovementMonth` (fatia 3).

**Erros:** `month` inválido ou futuro → 400 (`parseReferenceMonth`); `channel` fora de
`dineIn | delivery` → 400 (inclusive `shared`); sem token → 401. Tudo escopado por `restaurantId`.

Sem índice novo, sem comando no ambiente.

---

## Testes

**Unitário** — cada linha da tabela de regras; o cenário inteiro linha a linha; bordas: mês sem
dados, anterior 0, média `null` (restaurante novo), categoria apagada, duas contas de plataforma,
filtro de canal com `sharedExcluded`, saída marcada `delivery` entrando no filtro Delivery,
categoria `tax` no total e fora do CMV/prime cost.

**Integração** — o cenário por HTTP; reclassificar a categoria muda o mês passado; lançamento às
22h do último dia conta no próprio mês; dois restaurantes no mesmo ambiente não se misturam; filtro
de canal; 400 (mês inválido, futuro, canal inválido) e 401.

**E2E** — lançar CMV e uma venda em conta de plataforma com taxa; ler o relatório por HTTP real.

**Insomnia** — `GET /reports/expenses`.

Threshold de 90% nas quatro métricas.

---

## Entrega

1. **MintlyLib** `feat/20261013/custos-despesas` a partir de `staging` — `feat` sem `!`.
2. **MintlyApi** `feat/20261013/custos-despesas` a partir de `staging`.

Nenhum comando novo no ambiente.

---

## Fora de escopo

- Subitens, anomalias, "Fique de olho", selos de alerta, evolução por categoria — fatia 7.
- Períodos Hoje / 7 dias / Personalizado.
- Rateio da despesa compartilhada entre canais (N3).
- Proteção contra taxa de plataforma lançada também como despesa (N7).

---

## Self-review

- **Placeholders:** nenhum.
- **Consistência:** E2 (imposto no total) não afeta CMV/prime cost, que olham só `cmv`/`labor`;
  E3 e o `deliveryRevenue` usam a mesma `effectiveChannel`.
- **Ambiguidade:** média de 3 meses tem regra explícita para restaurante novo; itens que zeraram
  no mês aparecem (com −100%); taxa de plataforma tem canal definido (o da entrada).
- **Escopo:** uma rota, um conjunto de tipos, um método de client — cabe num plano.
