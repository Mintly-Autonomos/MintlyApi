# Módulos novos — guia para o front (contratos, clients, rotas e regras)

Documento de referência para construir as telas **Visão Geral, Fluxo de Caixa, Custos & Despesas e
Resultado**, e histórico do que foi feito no back (fatias 1–8 + ajustes pós-teste). Contratos copiados
de `mintly-lib@2.17.0-preview` (MintlyLib `staging`), comportamento da MintlyApi `staging` em
14/10/2026.

> Fonte da verdade: os tipos em `MintlyLib/src/core/data/reports/*.ts`,
> `src/core/data/financial/*`, `src/core/data/restaurant/*` e os clients em `src/clients/*`. As
> decisões de cada fatia estão nas specs listadas no fim (Histórico).

**Fora deste guia (bloqueado pelo domínio de vendas — N1/N2):** Receitas e Previsões, e o card
"Oportunidade no cardápio" da Visão Geral.

---

## Sumário

1. [Convenções gerais](#1-convenções-gerais)
2. [Clients e rotas](#2-clients-e-rotas)
3. [Mudanças no cadastro (movimentação, categoria, restaurante)](#3-mudanças-no-cadastro)
4. [Fluxo de Caixa — `GET /reports/cash-flow`](#4-fluxo-de-caixa)
5. [Resultado (DRE) — `GET /reports/result`](#5-resultado-dre)
6. [Custos & Despesas — `GET /reports/expenses`](#6-custos--despesas)
7. [Visão Geral — `GET /dashboard/overview`](#7-visão-geral)
8. [Regras que valem para várias telas](#8-regras-transversais)
9. [Nulos, estados vazios e erros](#9-nulos-estados-vazios-e-erros)
10. [Pendências para o front e o negócio](#10-pendências)
11. [Histórico](#11-histórico)

---

## 1. Convenções gerais

| Assunto | Regra |
|---|---|
| Headers | `env` **obrigatório** em toda requisição (seleciona o ambiente); `authorization: Bearer <token>` nas rotas protegidas (todas deste guia). O restaurante vem do token — não há `restaurantId` no header. Tipo `Headers` da lib. |
| Envelope | Sucesso: `{ payload: <dados> }` (`ResponseDto<T>`). Os clients devolvem o envelope; os dados estão em `.payload`. |
| Erros | `{ code, message }` (e `details` em validação). 400 `VALIDATION_ERROR` (schema) ou `APP-0005` (regra de negócio, ex.: mês futuro); 401 `AUTH-0001`; 404 `APP-0001`; 409 `AUTH-0002`; 500 `INTERNAL_ERROR`. |
| Dinheiro | **Número cru em reais**, 2 casas (ex.: `6372.5`). Formatação (R$, milhar, k) é do front. Somas feitas em centavos no back — não há erro de ponto flutuante a corrigir. |
| Percentuais | **Fração** (`0.36` = 36%). Exceção: `deltaPoints` (Visão Geral) vem em **pontos percentuais** (`2.8` = +2,8 p.p.). |
| Variações (`delta*`) | Fração relativa: `(atual − base) / base`. Base 0 → `null`. |
| Datas | `AAAA-MM-DD` / `AAAA-MM` no fuso **America/Sao_Paulo**. "Hoje", meses e dias são sempre de SP. |
| Mês (`?month=AAAA-MM`) | Padrão: mês corrente. Formato inválido ou **mês futuro → 400**. |
| Mês atual × fechado | Ver [§8.1](#81-mês-atual--mês-fechado-comparação-e-projeção). Os relatórios trazem `comparison` dizendo a base usada. |
| Textos | O back manda **dados estruturados** (insights com `kind` + números); a frase da tela é do front. |

---

## 2. Clients e rotas

Todos em `mintly-lib` (`import { ReportClient, DashboardClient, ... } from 'mintly-lib'`), também
acessíveis por `MasterClient` (`reportClient`, `dashboardClient`, `financialCategoryClient`,
`financialMovementClient`, `restaurantClient`). Base URL vem de `BACK_END_URL`.

### Relatórios (somente leitura)

| Client · método | HTTP | Query | Resposta (`payload`) |
|---|---|---|---|
| `ReportClient.cashFlow(query, headers)` | `GET /reports/cash-flow` | `{ horizon?: number }` 1..365 (padrão 30) | `CashFlowReport` |
| `ReportClient.result(query, headers)` | `GET /reports/result` | `{ month?: 'AAAA-MM' }` | `ResultReport` |
| `ReportClient.expenses(query, headers)` | `GET /reports/expenses` | `{ month?, channel?: 'dineIn' \| 'delivery' }` (sem canal = Geral) | `ExpensesReport` |
| `DashboardClient.overview(query, headers)` | `GET /dashboard/overview` | `{ month? }` | `OverviewReport` |
| `RestaurantClient.me(query, headers)` | `GET /restaurants/me` | `{ month? }` | `{ restaurant, tax: RestaurantTaxProfile }` |

### Escrita usada pelas telas novas

| Client · método | HTTP | Corpo | Observação |
|---|---|---|---|
| `RestaurantClient.updateMe(body, headers)` | `PATCH /restaurants/me` | `{ name?, taxRegime?: 'mei' \| 'simplesNacionalAnexoI' }` | Regime tributário (imposto do DRE) |
| `FinancialMovementClient.register(body, headers)` | `POST /financial-movements/` | `RegisterMovementRequest` (+ `dueDate`, `subcategoryId`, `channel`) | 409 = possível duplicata (<2 min) → reenviar com `confirmDuplicate: true` |
| `FinancialMovementClient.updateMovement(id, body, headers)` | `PATCH /financial-movements/:id` | `UpdateMovementRequest` (`null` limpa `dueDate`/`subcategoryId`/`channel`) | `direction` é imutável |
| `FinancialMovementClient.changeStatus(id, status, headers, { settledAt? })` | `PATCH /financial-movements/:id/status` | `{ status, settledAt? }` | `settledAt` = quando o dinheiro mexeu; ausente = agora; futuro → 400 |
| `FinancialCategoryClient.addSubcategory(catId, { name }, headers)` | `POST /financial-categories/:id/subcategories` | `{ name }` | 201; nome repetido (sem diferenciar maiúsculas, inclusive inativas) → 409 |
| `FinancialCategoryClient.updateSubcategory(catId, subId, { name }, headers)` | `PATCH /financial-categories/:id/subcategories/:subId` | `{ name }` | Renomear não reescreve lançamentos antigos |
| `FinancialCategoryClient.inactivateSubcategory(catId, subId, headers)` | `PATCH …/:subId/inactivate` | — | Nada é apagado |
| `FinancialCategoryClient.reactivateSubcategory(catId, subId, headers)` | `PATCH …/:subId/reactivate` | — | |
| `FinancialCategoryClient.update(id, body, headers)` | `PATCH /financial-categories/:id` | inclui `dreGroup`, `behavior: 'mixed'` | Categoria de sistema → 409 (o sub-recurso de subcategorias funciona nela) |

> **Atenção (tipo da lib):** `RegisterMovementRequest` e `UpdateMovementRequest` **não declaram
> `dueDate`**, mas a API aceita (`dueDate?: string | Date`; na edição `null` limpa). Até o tipo ser
> corrigido, envie com cast. Registrado nas pendências.

---

## 3. Mudanças no cadastro

### 3.1 Movimentação (`FinancialMovement`)

| Campo | O que é | Notas |
|---|---|---|
| `dueDate?: Date` | Vencimento (fatia 1, substitui `predictedReceiptDate`) | Em conta `platform`, o servidor calcula sozinho (`date + settlementDays`) se não vier. Com vencimento futuro o status nasce `pending`. |
| `settledAt?: Date` | Quando o dinheiro mexeu (fatia 2) | Preenchido ao liquidar (`changeStatus`) ou pelo job noturno de repasse. Leitura: `settledAt ?? dueDate ?? date`. |
| `statusSource?: 'auto' \| 'manual'` | Quem mudou o status por último | O job noturno liquida repasses de plataforma vencidos (`auto`). |
| `subcategory?: { _id, name }` | Subitem da categoria (fatia 5) | Opcional. Precisa ser da categoria escolhida e estar ativa (senão 400). Trocar a categoria remove a subcategoria. |
| `channel?: 'dineIn' \| 'delivery' \| 'shared'` | Canal (fatia 5) | Opcional — ausente, vale o **canal efetivo** ([§8.2](#82-canal-efetivo)). |

### 3.2 Categoria (`FinancialCategory`)

| Campo | O que é |
|---|---|
| `behavior: 'fixed' \| 'variable' \| 'mixed'` | `mixed` (Utilidades) é novo (fatia 3). No ponto de equilíbrio conta como **fixo**; em Custos aparece como "Misto". |
| `dreGroup: 'cmv' \| 'labor' \| 'tax' \| 'opex'` | Só em despesa (obrigatório nela; receita não tem). Cadastro de despesa sem grupo vira `opex`. As 6 categorias de sistema já vêm classificadas. `tax` (DAS lançado) **sai** das despesas do DRE (o imposto do DRE é pela alíquota). |
| `subcategories: { _id, name, status }[]` | Gerida só pelo sub-recurso (§2). Começa `[]`. |

### 3.3 Restaurante

- `taxRegime?: 'mei' | 'simplesNacionalAnexoI'` — sem regime, o imposto do DRE sai 0 e vem o insight `taxRegimeNotConfigured`.
- `GET /restaurants/me` → `{ restaurant, tax }` com `RestaurantTaxProfile`: `rbt12`, `effectiveRate`, faixa (`bracket`), `meiMonthlyDas`, uso do teto MEI (`meiCap`) e insights (`bracketChanged`, `meiCapNear`, `simplesLimitExceeded`, `taxRegimeNotConfigured`).

---

## 4. Fluxo de Caixa

`GET /reports/cash-flow?horizon=30` · `ReportClient.cashFlow` · spec `20261012/fluxo-de-caixa.md`.
Visão de **caixa** (quando o dinheiro entra/sai), não de competência.

```ts
interface CashFlowQuery { horizon?: number }            // 1..365, padrão 30

interface DailyPoint { date: string; balance: number; inflows: number; outflows: number }  // saldo no FIM do dia
interface CashFlowWeek { from: string; to: string; inflows: number; outflows: number }    // blocos de 7 dias (o último pode ser menor)

interface DueItem {
  id: string
  title: string
  category: { _id: string; name: string }
  direction: 'in' | 'out'
  amount: number                       // entrada: líquido (netValue); saída: bruto
  dueDate: string
  status: 'pending' | 'settled'
  overdue: boolean                     // pendente com vencimento antes de hoje
  settledAt?: string                   // só em liquidada
  kind?: 'movement' | 'platformPayout' // repasse de plataforma agrupado (ver abaixo)
  itemCount?: number                   // quantos lançamentos o item representa
}

interface CriticalDayInsight { kind: 'criticalDay'; severity: 'warning'; date: string; balance: number; threshold: number }

interface CashFlowReport {
  horizon: number
  today: string
  cashToday: number                    // Σ saldo disponível das contas ativas
  receivable: number                   // entradas pendentes até o fim do horizonte (vencidas incluídas)
  payable: number                      // saídas pendentes até o fim do horizonte (vencidas incluídas)
  projectedBalance: number             // = cashToday + receivable − payable = último ponto da projeção
  lowestBalance: { date: string; balance: number }
  overdue: { count: number; receivable: number; payable: number }
  safetyThreshold: { value: number; days: number; avgDailyOutflow: number }   // 7 dias de saída média
  projection: DailyPoint[]             // hoje .. hoje + horizon (horizon + 1 pontos)
  realized: DailyPoint[]               // 7 dias antes de hoje (mais antigo primeiro)
  weeks: CashFlowWeek[]
  dueItems: DueItem[]
  insights: CashFlowInsight[]          // hoje só 'criticalDay'
}
```

### Elemento da tela → campo

| Tela | Campo |
|---|---|
| Horizonte 30/60/90/Personalizado | `horizon` (1–365) |
| Caixa hoje ("somando todas as contas ativas") | `cashToday` |
| A receber / A pagar (N dias) + linha | `receivable` / `payable`; a linha é o acumulado de `projection[].inflows/outflows` (front) |
| Saldo previsto + "menor saldo ~R$ 900 no dia 22" | `projectedBalance`; `lowestBalance.{balance,date}` |
| Alerta "caixa vai ficar apertado por volta do dia X" | existe se há `insights[kind=criticalDay]`: `date` é o **primeiro dia abaixo da margem** de segurança (`threshold`); o valor/dia do fundo do poço é `lowestBalance` |
| Gráfico Projeção (linha cheia = passado, pontilhada = futuro, marcador "hoje") | `realized` (até ontem) + `projection` (hoje em diante). O 1º ponto da projeção é **hoje**, já com o que vence hoje — pode diferir de `cashToday`. |
| Entradas × Saídas por semana | `weeks` — 30 dias = **5 blocos** (7,7,7,7,3); o protótipo desenha 4 (juntar ou rotular o bloco curto) |
| Próximos vencimentos (por dia; abas Todos/A receber/A pagar/Vencidos) | `dueItems` (filtros por `direction`/`overdue` no front); badges Vencido/Pago/Recebido/Previsto por `status`+`overdue`+`direction`; "Dia crítico" = dia do `criticalDay` |

### Regras

- **Repasses de plataforma agrupados (ajuste A5):** entradas em conta `platform` (iFood, Rappi) viram
  **um item por conta × data de repasse × status** — `kind: 'platformPayout'`, título
  `"Repasse <nome atual da conta>"`, `amount` = Σ líquido, `itemCount` = nº de pedidos,
  `id = "payout:<accountId>:<data>:<status>"`, `category = { _id: '', name: 'Repasse de plataforma' }`.
  Pendente usa o `dueDate`; já recebido usa o dia em que caiu (`settledAt`). Pendente e recebido no
  mesmo dia viram dois itens. **Antes de navegar para a movimentação, cheque `kind`** — o item agrupado
  não tem uma movimentação só.
- Venda à vista não entra na lista (só o que tem vencimento). Liquidadas aparecem nos últimos 7 dias.
- A série realizada é reconstruída a partir do saldo de hoje (não há histórico de saldo — N12).

---

## 5. Resultado (DRE)

`GET /reports/result?month=AAAA-MM` · `ReportClient.result` · spec `20261012/resultado-dre.md`.
Visão de **competência** (data do lançamento), canceladas fora.

```ts
interface ReportComparison { kind: 'samePeriod' | 'fullMonth'; untilDay: number | null }

interface ResultLines {
  grossRevenue: number
  taxes: number                        // Simples: alíquota efetiva × receita; MEI: DAS do mês; sem regime: 0
  netRevenue: number                   // bruta − impostos
  cmv: number
  grossMargin: number                  // líquida − CMV
  operatingExpenses: number            // pessoal + opex + taxa de plataforma (sem CMV e sem DAS lançado)
  netProfit: number
  netMargin: number | null             // lucro / receita bruta; null sem receita
}

interface OpexItem {
  categoryId: string | null            // null na taxa de plataforma
  name: string                         // "Taxa de plataforma" = todas as contas somadas
  kind: 'labor' | 'opex' | 'platformFee'
  behavior: 'fixed' | 'variable' | 'mixed'
  amount: number
  previousAmount: number
  delta: number | null
  revenuePct: number | null
}

type ResultInsight =
  | { kind: 'profitChanged'; severity: 'positive' | 'warning'; difference: number; previousProfit: number; currentProfit: number; previousMargin: number | null; currentMargin: number | null }
  | { kind: 'largestOpexItem'; severity: 'warning'; name: string; amount: number; revenuePct: number | null }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

interface ResultBreakEven {
  fixedCosts: number                   // misto conta como fixo
  variableCosts: number
  contributionMarginPct: number | null // sobre a receita LÍQUIDA
  breakEvenRevenue: number | null      // receita BRUTA que paga os fixos
  reachedOnDay: number | null          // dia do mês em que a receita acumulada passou o equilíbrio
}

interface ResultReport {
  referenceMonth: string
  previousMonth: string
  current: ResultLines
  previous: ResultLines                // no mês atual: o anterior ATÉ O MESMO DIA (ver comparison)
  deltas: Record<'grossRevenue' | 'taxes' | 'netRevenue' | 'cmv' | 'grossMargin' | 'operatingExpenses' | 'netProfit', number | null>
  tax: { regime: 'mei' | 'simplesNacionalAnexoI' | null; effectiveRate: number | null; meiMonthlyDas: number | null }
  operatingExpenseItems: OpexItem[]    // maior primeiro
  breakEven: ResultBreakEven
  history: { month: string; grossRevenue: number; netProfit: number; netMargin: number | null }[]  // 6 meses, meses CHEIOS
  insights: ResultInsight[]
  comparison: ReportComparison
}
```

### Elemento da tela → campo

| Tela | Campo |
|---|---|
| "Sobrou no fim das contas" + margem + "+24,9% vs. Junho" | `current.netProfit`, `current.netMargin`, `deltas.netProfit`, `previousMonth` (no mês atual: "vs. 1–`untilDay` de junho") |
| Ponto de equilíbrio (valor, custos fixos, barra) | `breakEven.breakEvenRevenue`, `fixedCosts`; barra = `current.grossRevenue / breakEvenRevenue` (front) |
| "Você atinge por volta do dia 16" | `breakEven.reachedOnDay` (só depois de atingido; no mês atual antes disso não há estimativa) |
| "Cada real vendido depois disso tem X% de margem" | **use `fixedCosts / breakEvenRevenue`** (margem sobre a bruta). `contributionMarginPct` é sobre a líquida. |
| Receita bruta / Margem bruta / Despesas operacionais / Margem líquida + "% da receita" + variação | `current.*`, `deltas.*`; o % é `linha / grossRevenue` (front); "Era 9,4% em Junho" = `previous.netMargin` |
| Leitura do mês (positivo / atenção) | `insights[profitChanged]`, `insights[largestOpexItem]` (+ `current.cmv` para "junto com o CMV de …") |
| Cascata "Como seu lucro se forma" | `current.grossRevenue`, `taxes`, `cmv`, `operatingExpenses`, `netProfit` (valores positivos; sinais e lucro negativo no front) |
| Linha a linha do mês (R$ / % da receita) | `current` + `deltas` + `previousMonth` |
| Composição das despesas operacionais | `operatingExpenseItems` (tag por `behavior` — `mixed` vem cru; "estável" é limiar do front) |
| Últimos 6 meses (lucro + margem) | `history` |
| Aviso de regime | `insights[taxRegimeNotConfigured]` |

### Regras

- **Mês atual** ([§8.1](#81-mês-atual--mês-fechado-comparação-e-projeção)): `previous`, `deltas` e `profitChanged` comparam os mesmos dias; o mês atual também é cortado em hoje para comparar (o que já está lançado para depois de hoje aparece em `current`, mas não infla a variação). `history` é sempre de meses cheios.
- Categoria com valor 0 no mês e no anterior não aparece na composição.
- Classificação é a **atual** da categoria: reclassificar muda os meses passados.
- O nome da linha de taxa no DRE é "Taxa de plataforma" (uma linha); em Custos é uma por conta ("Taxa iFood").

---

## 6. Custos & Despesas

`GET /reports/expenses?month=AAAA-MM&channel=dineIn|delivery` · `ReportClient.expenses` · specs
`20261013/custos-despesas.md` (fatia A) e `custos-despesas-b.md` (fatia B). Competência; **todas as
saídas** entram (inclusive DAS lançado) + a taxa de plataforma.

```ts
interface ExpensesQuery { month?: string; channel?: 'dineIn' | 'delivery' }   // sem channel = Geral; 'shared' → 400

interface ExpenseSubitem {
  key: string                          // subcategoryId | 'none'
  subcategoryId: string | null         // null = "Sem subitem"
  name: string                         // nome ATUAL da subcategoria (mesmo inativa) | "Sem subitem"
  amount: number
  previous: number
  average3: number | null
  deltaPrevious: number | null
  deltaAverage3: number | null
  anomaly: boolean
}

interface ExpenseItem {
  key: string                          // categoryId | 'platformFee:<accountId>'
  kind: 'category' | 'platformFee'
  categoryId: string | null
  name: string                         // nome atual; taxa: "Taxa <nome atual da conta>"
  behavior: 'fixed' | 'variable' | 'mixed'
  dreGroup: 'cmv' | 'labor' | 'tax' | 'opex' | null   // taxa → null
  amount: number
  previous: number
  average3: number | null              // média de M−1..M−3 desde o 1º lançamento; null sem mês elegível
  deltaPrevious: number | null
  deltaAverage3: number | null
  pctOfRevenue: number | null
  subitems: ExpenseSubitem[]           // [] se a categoria não tem lançamento com subcategoria; taxa → []
  hasAnomaly: boolean                  // selo "alerta"
  history: { month: string; amount: number }[]   // 6 meses (gráfico "Por categoria")
  projected: number | null             // projeção do mês atual; null em mês fechado
}

interface ExpenseAnomaly {
  itemKey: string                      // ExpenseItem.key
  categoryId: string | null
  categoryName: string
  subcategoryId: string | null
  subitemKey: string | null            // null = a categoria inteira foi avaliada
  name: string                         // subitem ou categoria
  amount: number
  average3: number
  excess: number                       // amount − average3
  pctAbove: number                     // excess / average3
}

interface ExpensesReport {
  referenceMonth: string
  previousMonth: string
  channel: 'dineIn' | 'delivery' | null
  revenue: { current: number; previous: number }   // receita bruta (do canal, se filtrado)
  total: { current: number; previous: number; average3: number | null; deltaPrevious: number | null; deltaAverage3: number | null }
  cmv: { amount: number; pctOfRevenue: number | null; target: { min: number; max: number } }        // 0.28 / 0.35 (MIN-84)
  primeCost: { amount: number; cmv: number; labor: number; pctOfRevenue: number | null; targetMax: number }  // 0.65
  platformFee: { amount: number; previous: number; deltaPrevious: number | null; deliveryRevenue: number; pctOfDelivery: number | null }
  byBehavior: { fixed: number; variable: number; mixed: number }
  items: ExpenseItem[]                 // maior valor primeiro
  sharedExcluded: number | null        // só com channel: despesas "da casa" que ficaram de fora
  history: { month: string; total: number }[]       // 6 meses
  anomalies: ExpenseAnomaly[]          // "Fique de olho", maior excedente primeiro
  projection: { total: number; revenue: number; elapsedDays: number; daysInMonth: number } | null   // só no mês atual
  anomalyRule: { minPctAbove: number; minExcess: number; minHistoryMonths: number }                // 0.5 / 100 / 2
  comparison: ReportComparison
}
```

### Elemento da tela → campo

| Tela | Campo |
|---|---|
| Total de despesas + "+9,7% vs. mês anterior" + linha | `total.current`, `total.deltaPrevious`, `history[].total` |
| CMV % + R$ + barra + "Alvo 28–35%" | `cmv.pctOfRevenue`, `cmv.amount`, `cmv.target` |
| Prime Cost % + "R$ X de CMV + pró-labore" + barra dupla | `primeCost.{pctOfRevenue, amount, cmv, labor, targetMax}` |
| Taxa iFood R$ + "23% do delivery" + variação | `platformFee.amount`, `pctOfDelivery`, `deltaPrevious`. O card soma **todas** as contas de plataforma — o título pode usar o `name` do único item `kind=platformFee` quando houver um só |
| Fique de olho ("Embalagens acima do normal… R$ 900 a mais… (+60%)… em CMV / Insumos") | `anomalies[].{name, excess, pctAbove, categoryName}`; "Ver detalhes" → abrir o item `itemKey` / subitem `subitemKey` |
| vs. mês anterior / vs. média 3 meses · R$ / % da receita | `deltaPrevious` / `deltaAverage3`; `amount` / `pctOfRevenue` (item e subitem) — sem nova chamada |
| Todos / Só variáveis / Só fixos | filtro no front por `behavior` (decidir onde entra `mixed`) |
| Geral / Salão / Delivery | **nova chamada** com `channel`; mostrar `sharedExcluded` ("R$ X da casa não entra neste filtro") |
| Linha da categoria: nome, selo "alerta", tipo, barra, valor, % | `name`, `hasAnomaly`, `behavior`, `amount`, delta; barra relativa ao maior (front) |
| Abrir categoria (subitens, "fora do padrão") | `subitems[]` (`anomaly`) |
| Rodapé "8 categorias · R$ 46.468" | `items.length`, `total.current` |
| Evolução das despesas (Total / Por categoria, pontilhado = projeção) | `history` / `items[].history`; projeção: `projection.total` e `items[].projected` (mês atual) |
| Ponto destacado de salto atípico | o mês de referência com `hasAnomaly` (meses passados não são avaliados) |

### Regras

- **Canal efetivo** ([§8.2](#82-canal-efetivo)); no filtro, despesa "da casa" (`shared`) fica fora e vai para `sharedExcluded`. Na prática, enquanto o dono não marca canal nas saídas, **Salão** mostra quase nada (rateio é a pendência N3).
- **Taxa de plataforma:** uma linha por conta (`Taxa iFood`, `Taxa Rappi`); `pctOfDelivery` = taxa ÷ receita bruta das **contas de plataforma** (a venda própria marcada delivery não paga taxa).
- **Subitens:** só existem se a categoria tem algum lançamento com subcategoria na janela; os sem subcategoria viram "Sem subitem" (sempre por último). Σ subitens = valor da categoria.
- **Anomalia** ([§8.3](#83-anomalia-fique-de-olho)).
- **Projeção** ([§8.1](#81-mês-atual--mês-fechado-comparação-e-projeção)): variável linear; fixo/misto pela média.
- **Itens listados:** com valor no mês, no anterior ou na média; no mês atual também os que tiveram gasto no mês fechado e os fixos com projeção (o aluguel ainda não pago aparece com R$ 0 e `projected`).

---

## 7. Visão Geral

`GET /dashboard/overview?month=AAAA-MM` · `DashboardClient.overview` · spec `20261013/visao-geral.md`.
Composição: DRE + Custos (do mês) + Fluxo de Caixa de 30 dias (**sempre de hoje**). Cada número
tem a mesma fonte da tela de origem.

```ts
interface OverviewQuery { month?: string }

interface OverviewCards {
  netProfit: { amount: number; delta: number | null; history: { month: string; amount: number }[] }   // DRE
  revenue: { amount: number; delta: number | null; history: { month: string; amount: number }[] }     // DRE
  cashToday: { amount: number; realized: { date: string; balance: number }[] }                       // Fluxo (hoje)
  projection: { horizon: number; balance: number; lowest: { date: string; balance: number }; runwayDays: number | null }  // Fluxo 30d + fôlego
  cmv: { pct: number | null; previousPct: number | null; deltaPoints: number | null; target: { min: number; max: number } }  // Custos
  primeCost: { pct: number | null; previousPct: number | null; deltaPoints: number | null; targetMax: number }              // Custos
}

type HealthLabel = 'risk' | 'attention' | 'healthy' | 'noData'
type HealthPillarKey = 'netMargin' | 'runway' | 'primeCost' | 'revenueTrend'
interface HealthPillar { key: HealthPillarKey; weight: number; score: number | null; value: number | null }

interface OverviewHealth {
  score: number | null                 // 0–100; null = sem dados (menos de 2 pilares)
  label: HealthLabel
  basisMonth: string                   // mês dos pilares do mês (ver regras)
  pillars: HealthPillar[]
  bands: { risk: number; attention: number }   // 40 / 70
}

type OverviewInsight =
  | { kind: 'cashTight'; severity: 'warning'; date: string; balance: number }
  | { kind: 'cmvAboveTarget'; severity: 'warning'; pct: number; targetMax: number; impact: number; basisMonth: string }
  | { kind: 'primeCostAboveTarget'; severity: 'warning'; pct: number; targetMax: number; basisMonth: string }
  | { kind: 'expenseAnomaly'; severity: 'warning'; name: string; categoryName: string; excess: number; pctAbove: number }
  | { kind: 'breakEvenReached'; severity: 'positive'; day: number }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

interface RevenueVsExpensePoint { month: string; revenue: number; expense: number; projected: boolean }
interface ProfitWaterfall { grossRevenue: number; taxes: number; cmv: number; operatingExpenses: number; netProfit: number }

interface OverviewReport {
  referenceMonth: string
  today: string                        // referência dos blocos de caixa
  cards: OverviewCards
  health: OverviewHealth
  insights: OverviewInsight[]          // no máximo 4: warning → positive → info
  revenueVsExpense: RevenueVsExpensePoint[]
  profitWaterfall: ProfitWaterfall
  comparison: ReportComparison
}
```

### Elemento da tela → campo

| Tela | Campo |
|---|---|
| Saúde financeira (nota, rótulo, "Ver como calculamos") | `health.score`, `label`, `pillars[]` (peso/nota/valor), `bands`, `basisMonth` — a frase ("tendência e margem estão bem, fique de olho em fôlego") sai do melhor/pior pilar (front) |
| Lucro do mês + variação + linha | `cards.netProfit` |
| Caixa hoje + linha | `cards.cashToday` (`realized` = 7 dias; o front acrescenta o ponto de hoje) |
| Projeção 30 dias + "Estimativa" + "fôlego de ~20 dias" | `cards.projection.balance`, `runwayDays`. **Não há série** para a linha desse card (usar `/reports/cash-flow` se precisar) |
| CMV % + "+3 p.p." + barra + alvo | `cards.cmv.{pct, deltaPoints, target}` |
| Prime Cost % + p.p. + barra + "Alvo ≤ 65%" | `cards.primeCost.{pct, deltaPoints, targetMax}` (o protótipo diz "60–65%"; vale 65% — MIN-84) |
| Receita do mês + variação + linha | `cards.revenue` |
| O que fazer primeiro | `insights[]` — "Custo dos ingredientes acima do ideal… reduziu seu lucro em R$ X" = `cmvAboveTarget.impact` (**excesso sobre o teto do alvo**, não "subiu no mês"); "Caixa apertado a partir do dia 22… R$ 900" = `cashTight.date` + `cards.projection.lowest`; "Ponto de equilíbrio atingido desde o dia 19" = `breakEvenReached.day` |
| Receita × Despesa (6 meses + projeção) | `revenueVsExpense` — o mês atual aparece **duas vezes** (real e `projected: true`); "Despesa" aqui = todas as saídas (igual a Custos) |
| Como seu lucro se forma | `profitWaterfall` (= DRE do mês) |

### Regras

- **Score (palpite N5):** 4 pilares, nota linear entre duas pontas, limitada a 0–100:

  | Pilar | Peso | Nota 0 | Nota 100 |
  |---|---|---|---|
  | `netMargin` (margem líquida) | 0,30 | ≤ 0% | ≥ 10% |
  | `runway` (fôlego, dias) | 0,30 | 0 | ≥ 45 |
  | `primeCost` | 0,25 | ≥ 85% | ≤ 65% |
  | `revenueTrend` (receita × média dos 3 meses anteriores com receita) | 0,15 | ≤ −20% | ≥ 0% |

  Pilar sem dado sai e os pesos se redistribuem; **menos de 2 pilares → `score: null`, `noData`**.
  Faixas: < 40 `risk`, < 70 `attention`, ≥ 70 `healthy`.
- **Base do score (`basisMonth`):** no **mês atual** = último mês **fechado** (margem, prime cost, tendência) + fôlego de hoje — o mês pela metade não derruba a nota. Em **mês passado** = o próprio mês, **sem** o fôlego (não existe o caixa daquela época), e a nota não muda com o tempo.
- **Insights de CMV/prime cost** usam a mesma base do score (`basisMonth`). Os **cards** de CMV/prime mostram o mês consultado (no mês atual, até agora) — podem diferir do insight; mostre o mês do insight.
- **Fôlego** = `floor(caixa de hoje ÷ saída média diária)` (média de até 90 dias desde o 1º lançamento); média 0 → `null`; caixa ≤ 0 → 0.
- `expenseAnomaly` é a primeira anomalia de Custos do mês consultado.

---

## 8. Regras transversais

### 8.1 Mês atual × mês fechado (comparação e projeção)

| | Mês fechado | Mês atual (hoje = dia D) |
|---|---|---|
| Valor exibido (`current`, `amount`, `total.current`) | mês cheio | do dia 1 até o fim do mês **já lançado** (inclui o que está agendado para depois de hoje) |
| Base de comparação (`previous`, `average3`, deltas, `profitChanged`) | meses cheios | **mesmos dias** (1..D) dos meses anteriores, e o mês atual cortado em hoje — `comparison = { kind: 'samePeriod', untilDay: D }` |
| `history` | meses cheios | meses cheios (o mês atual parcial é o último ponto) |
| Projeção | `null` | variável/taxa: linear (`até hoje × dias do mês ÷ dias decorridos` + agendado); fixo/misto: `max(valor do mês, média dos meses cheios desde o 1º gasto)`; `projection.total` = Σ itens; receita linear + agendada |
| Anomalia | contra a média de 3 meses | contra a média do mesmo período, **só a partir do dia 7** |

Rótulo sugerido no mês atual: "vs. 1–13 de set" (use `comparison.untilDay` e `previousMonth`).

### 8.2 Canal efetivo

O canal informado no lançamento vence; sem canal: **entrada em conta plataforma → `delivery`**,
outra entrada → `dineIn`, **saída → `shared`** (da casa inteira).

### 8.3 Anomalia ("Fique de olho")

Avaliada por **subitem** (inclusive "Sem subitem"); categoria sem subitens é avaliada inteira; **taxa
de plataforma nunca**. Dispara quando: ≥ 2 meses de base (contados desde o primeiro gasto daquela
unidade — quem começou a usar a subcategoria agora não gera alerta falso) **e** média > 0 **e**
excedente ≥ R$ 100 **e** excedente ÷ média ≥ 50% (palpite N4; `anomalyRule` traz os números). Só o
mês consultado é avaliado.

### 8.4 Três sentidos de "despesa" (cuidado com rótulos)

| Onde | O que soma |
|---|---|
| Custos (`total`) e Visão Geral Receita × Despesa (`expense`) | **todas as saídas**: CMV, pessoal, opex, DAS lançado, taxas de plataforma |
| Resultado / cascata (`operatingExpenses`) | pessoal + opex + taxa de plataforma (sem CMV, sem DAS lançado) |
| Imposto do DRE (`taxes`) | calculado pela alíquota/DAS, não pelos lançamentos |

Sugestão: "Saídas" × "Despesas operacionais".

---

## 9. Nulos, estados vazios e erros

**Campos que podem vir `null`:** `netMargin`, `pctOfRevenue`, todos os `delta*`/`deltaPoints`,
`average3`, `runwayDays`, `health.score` (`noData`), `pillar.score/value`, `contributionMarginPct`,
`breakEvenRevenue`, `reachedOnDay`, `projection`/`projected` (mês fechado), `sharedExcluded` (Geral),
`tax.effectiveRate`/`meiMonthlyDas`, `previousPct`. Lucro pode ser negativo (inverter a última barra
da cascata).

**Restaurante sem lançamentos:** tudo 200, zeros, listas vazias, `score: null`, nenhum `NaN`.

**Erros por rota**

| Rota | 400 | 401 | 404 / 409 |
|---|---|---|---|
| `/reports/cash-flow` | `horizon` fora de 1..365 ou não numérico | sem/inválido token | — |
| `/reports/result`, `/dashboard/overview` | `month` inválido (`2026-13`, `2026-1`) ou futuro | idem | — |
| `/reports/expenses` | idem + `channel` diferente de `dineIn`/`delivery` (inclusive `shared`) | idem | — |
| Subcategorias | nome vazio / > 60 | idem | 404 categoria/subcategoria de outro restaurante ou inexistente; 409 nome repetido |
| Movimentação | subcategoria de outra categoria ou inativa; canal inválido; `settledAt` futuro | idem | 409 possível duplicata (`confirmDuplicate`) |

---

## 10. Pendências

**Para o front decidir/contornar**
- "Despesa" com três sentidos ([§8.4](#84-três-sentidos-de-despesa-cuidado-com-rótulos)) — rótulos diferentes.
- Ponto projetado: a API projeta o **fechamento do mês atual** no mesmo `month` (duplicado, `projected: true`); o protótipo desenha "mês seguinte (proj.)". Definir o desenho.
- Semanas do Fluxo: 5 blocos para 30 dias.
- Card "Projeção 30 dias" sem série; título do card de taxa quando há mais de uma plataforma; onde o "misto" entra nos filtros Só fixos/Só variáveis.
- Item de repasse agrupado: checar `kind` antes de navegar.
- Tipos `RegisterMovementRequest`/`UpdateMovementRequest` sem `dueDate` (a API aceita) — corrigir na lib.

**Para o negócio**
- **N3** rateio da despesa compartilhada entre canais (Salão quase vazio sem isso).
- **N4** limiares de anomalia (50% / R$ 100 / 2 meses / a partir do dia 7).
- **N5** pesos, pontas e faixas do score; mínimo de 2 pilares.
- **N7** taxa de plataforma lançada também como despesa (conta em dobro).
- Natureza não operacional (aporte de sócio, empréstimo) conta como receita/despesa em todos os relatórios — falta regra.
- **N1/N2** domínio de vendas (Receitas, Previsões, cardápio).

**Ambiente:** comandos de staging das fatias 1 (`backfill-due-date`) e 3 (`backfill-dre-group`,
`seed-tax-settings` — precisa do DAS 2026 para MEI). Ver `andamento.md`.

---

## 11. Histórico

| # | Entrega | Lib | API | Spec |
|---|---|---|---|---|
| 1 | `dueDate` na movimentação (M1), settler usa vencimento | #26 (`2.9.0-preview`) | #39 | `20260929/design.md` (M1) |
| 2 | Fluxo de Caixa + `settledAt` | #27 (`2.10.0-preview`) | #40 | `20261012/fluxo-de-caixa.md` |
| 3 | `dreGroup`, `mixed`, regime tributário e alíquota (M2, M5) | #28 (`2.11.0-preview`) | #41 | `20261012/classificacao-contabil.md` |
| 4 | Resultado (DRE) | #29 (`2.12.0-preview`) | #42 | `20261012/resultado-dre.md` |
| 5 | Subcategoria + canal (M3, M4) | #30 (`2.13.0-preview`) | #43 | `20261013/subcategoria-canal.md` |
| 6 | Custos & Despesas — fatia A | #31 (`2.14.0-preview`) | #44 | `20261013/custos-despesas.md` |
| 7 | Custos & Despesas — fatia B (subitens, anomalias, evolução) | #32 (`2.15.0-preview`) | #45 | `20261013/custos-despesas-b.md` |
| 8 | Visão Geral | #33 (`2.16.0-preview`) | #46 | `20261013/visao-geral.md` |
| — | Ajustes pós-teste das telas (mês atual, projeção, insights, score, repasses) | #34 (`2.17.0-preview`) | #47 | `20261014/ajustes-telas.md` |

**Como foi validado:** TDD em cada regra; suíte da API com ~990 testes e cobertura ≥ 96% (as quatro
métricas ≥ 90%); E2E contra Atlas por fatia; revisão independente por fatia; teste local de ponta a
ponta por fatia; e, no fim, bateria pesada local (5 restaurantes, ~4.700 lançamentos, todos os
meses/canais/horizontes, entradas inválidas, isolamento entre restaurantes, oráculo independente):
**57.734 checagens, 0 falhas**; telas < 110 ms com ~3.900 lançamentos.

Roteiro geral: `20260929/design.md`. Decisões de negócio em aberto: `pendencias-negocio.md`. Estado
atual e comandos de ambiente: `andamento.md`. Coleção Insomnia: `insomnia/MintlyApi.insomnia_v4.json`
(pastas Reports, Dashboard, Restaurant e subcategorias).
