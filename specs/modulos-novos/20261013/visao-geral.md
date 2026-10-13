# Fatia 8 — Visão Geral

`GET /dashboard/overview` · cards do mês e de hoje · score de saúde · "O que fazer primeiro" ·
Receita × Despesa · cascata do lucro

Roteiro geral: `specs/modulos-novos/20260929/design.md` (3.4). Base: fatias 2 (Fluxo de Caixa),
4 (Resultado), 6 e 7 (Custos & Despesas). Este documento detalha a fatia.

---

## Contexto

A Visão Geral (prints `095409` a `095556`) é a tela de entrada:

- cards: Lucro do mês, Caixa hoje, Projeção 30 dias (com fôlego), CMV, Prime Cost, Receita do mês;
- "Saúde financeira": nota 0–100, rótulo (Saudável / Atenção / Risco), frase e "Ver como calculamos";
- "O que fazer primeiro": cards de atenção, positivo (e oportunidade de cardápio — fora, N1);
- "Receita vs. Despesa": 6 meses e a projeção;
- "Como seu lucro se forma": cascata receita → impostos → CMV → despesas → lucro.

É composição: reaproveita as consultas das fatias anteriores, mais dois cálculos próprios (fôlego
e score).

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| V1 | Score com a **proposta do design** (pesos 30/30/25/15, faixas 40/70) em constantes marcadas como palpite do **N5**; a resposta traz pilares, pesos e notas | MIN-83 não define; ajustável sem mexer no contrato |
| V2 | Pilar → nota **linear** entre duas pontas; pilar **sem dado sai** e os pesos se redistribuem; nenhum → `noData` | Restaurante novo não é punido por falta de histórico |
| V3 | `?month=AAAA-MM` (padrão o corrente, futuro → 400); blocos de caixa **sempre de hoje** | Mesmo contrato do DRE e de Custos; caixa só existe "agora" |
| V4 | "O que fazer primeiro" = **catálogo fixo** de 6 insights, ordem por severidade e catálogo, **máximo 4**; texto no front | Mesma forma dos insights do DRE e do Fluxo |
| V5 | Abordagem: `OverviewQuery` compõe `ResultQuery`, `CashFlowQuery(30)` e `ExpensesQuery` em paralelo, com o mesmo relógio; regra pura monta a resposta | Um número só por conceito entre telas; nenhuma consulta nova ao Mongo |

**Alternativas recusadas:** adiar o score; pilares sem nota final; degraus 0/50/100; pilar sem
dado = 0; só mês corrente; horizonte de caixa como parâmetro; insights sem limite ou só de atenção;
pipeline próprio no Mongo.

---

## Contrato (MintlyLib) — aditivo

```ts
interface OverviewQuery { month?: string }

interface OverviewReport {
  referenceMonth: string
  today: string                     // AAAA-MM-DD em SP — referência dos blocos de caixa
  cards: {
    netProfit:  { amount: number; delta: number | null; history: { month: string; amount: number }[] }
    revenue:    { amount: number; delta: number | null; history: { month: string; amount: number }[] }
    cashToday:  { amount: number; realized: { date: string; balance: number }[] }
    projection: { horizon: number; balance: number; lowest: { date: string; balance: number }; runwayDays: number | null }
    cmv:        { pct: number | null; previousPct: number | null; deltaPoints: number | null; target: { min: number; max: number } }
    primeCost:  { pct: number | null; previousPct: number | null; deltaPoints: number | null; targetMax: number }
  }
  health: {
    score: number | null
    label: HealthLabel              // 'risk' | 'attention' | 'healthy' | 'noData'
    pillars: HealthPillar[]
    bands: { risk: number; attention: number }   // 40 / 70
  }
  insights: OverviewInsight[]
  revenueVsExpense: { month: string; revenue: number; expense: number; projected: boolean }[]
  profitWaterfall: { grossRevenue: number; taxes: number; cmv: number; operatingExpenses: number; netProfit: number }
}

type HealthPillarKey = 'netMargin' | 'runway' | 'primeCost' | 'revenueTrend'
interface HealthPillar { key: HealthPillarKey; weight: number; score: number | null; value: number | null }

type OverviewInsight =
  | { kind: 'cashTight'; severity: 'warning'; date: string; balance: number }
  | { kind: 'cmvAboveTarget'; severity: 'warning'; pct: number; targetMax: number; impact: number }
  | { kind: 'primeCostAboveTarget'; severity: 'warning'; pct: number; targetMax: number }
  | { kind: 'expenseAnomaly'; severity: 'warning'; name: string; categoryName: string; excess: number; pctAbove: number }
  | { kind: 'breakEvenReached'; severity: 'positive'; day: number }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }
```

Client novo `DashboardClient.overview(query, headers)` → `GET /dashboard/overview` (compõe
`HttpBaseClient('dashboard')`, como o `ReportClient`). Tipos e client exportados pelos barrels.
`feat` sem `!`.

---

## Regras

Puras em `src/app/dashboard/overview-metrics.ts`; somas em centavos onde houver soma.

| Regra | Definição |
|---|---|
| Lucro / Receita | DRE: `current.netProfit` / `current.grossRevenue`, `deltas.netProfit` / `deltas.grossRevenue`, `history` (6 meses) |
| Caixa hoje | Fluxo: `cashToday`, `realized` (7 dias) |
| Projeção | Fluxo (horizonte 30): `projectedBalance`, `lowestBalance` |
| Fôlego (`runwayDays`) | `floor(cashToday / safetyThreshold.avgDailyOutflow)` (média diária de 90 dias desde o 1º lançamento, já do Fluxo); média 0 → `null`; caixa ≤ 0 → 0 |
| CMV % / prime cost % | Custos: `cmv.pctOfRevenue`, `primeCost.pctOfRevenue`. Anterior: Σ `previous` dos itens `cmv` (e `labor`) / `revenue.previous` (receita 0 → `null`). `deltaPoints = (pct − previousPct) × 100`; algum `null` → `null` |
| Pilar `netMargin` | valor = margem líquida do DRE; 0% → 0, 10% → 100 |
| Pilar `runway` | valor = fôlego; 0 → 0, 45 → 100 |
| Pilar `primeCost` | valor = prime cost %; 85% → 0, 65% → 100 |
| Pilar `revenueTrend` | valor = (receita base − média) / média. Receita base = receita do mês; **se o mês é o atual**, projetada: `receita × dias do mês / dias decorridos` (SP). Média = meses M−1..M−3 do histórico com receita > 0; nenhum → sem dado. −20% → 0, 0% → 100 |
| Nota do pilar | Linear entre as pontas, limitada a 0..100, sem arredondar |
| Score | `round(Σ peso × nota / Σ peso)` dos pilares com nota; nenhum → `null` |
| Rótulo | `< 40` risk · `< 70` attention · `≥ 70` healthy · sem score → noData |
| Insights | `cashTight` ← Fluxo tem `criticalDay`; `cmvAboveTarget` ← CMV % > 35%, `impact = round((pct − 0,35) × receita)` ao centavo; `primeCostAboveTarget` ← prime cost % > 65%; `expenseAnomaly` ← 1ª anomalia de Custos; `breakEvenReached` ← DRE `breakEven.reachedOnDay`; `taxRegimeNotConfigured` ← insight do DRE. Ordem: warning → positive → info, depois a ordem desta lista; máximo 4 |
| Receita × Despesa | M−5..M: receita bruta (DRE `history`) e despesa (Custos `history`, todas as saídas + taxas). Mês atual: mais um ponto `projected: true` com a receita projetada e `projection.total` de Custos |
| Cascata | Linhas do DRE do mês: `grossRevenue`, `taxes`, `cmv`, `operatingExpenses`, `netProfit` |

Constantes (palpite N5): pesos `netMargin 0,30 · runway 0,30 · primeCost 0,25 · revenueTrend 0,15`;
pontas da tabela; faixas 40 / 70. Metas de CMV/prime cost vêm de Custos (MIN-84).

---

## API

```
src/app/dashboard/
  overview-metrics.ts          regras puras; computeOverview(input) → OverviewReport
  overview-scenario.ts         entradas montadas (relatórios) para os testes
  use-cases/overview.query.ts  compõe ResultQuery, CashFlowQuery(30), ExpensesQuery
  overview-controller.ts
  overview-routes.ts           GET /dashboard/overview (área autenticada)
```

**Erros:** `month` inválido/futuro → 400 (das consultas existentes); sem token → 401.

Sem índice novo, sem comando no ambiente.

---

## Testes

**Unitário** — pontas e limites de cada pilar; redistribuição de pesos e `noData`; faixas 39/40/69/70;
fôlego (média 0, caixa negativo, arredondamento para baixo); tendência com mês atual projetado e sem
meses com receita; `deltaPoints`; catálogo, ordem e corte em 4; Receita × Despesa com e sem ponto
projetado; cascata.

**Integração** — cenários do DRE e de Custos plantados num mês passado: cards, cascata, score e
insights conferidos; mês atual com ponto projetado; 400, 401; dois restaurantes não se misturam.

**E2E** — lançamentos por HTTP real e leitura da Visão Geral.

**Insomnia** — pasta "Dashboard" com a requisição.

Threshold de 90% nas quatro métricas.

---

## Entrega

1. **MintlyLib** `feat/20261013/visao-geral` a partir de `staging` — `feat` sem `!`.
2. **MintlyApi** `feat/20261013/visao-geral` a partir de `staging`.

Nenhum comando novo no ambiente.

---

## Fora de escopo

- Insight de oportunidade no cardápio (N1 — domínio de vendas).
- Períodos Hoje / 7 dias / Personalizado.
- Validação dos pesos e faixas com o negócio (N5 segue aberto).
- Histórico do score.

---

## Self-review

- **Placeholders:** nenhum.
- **Consistência:** CMV/prime cost vêm de Custos (mesmo número da tela de Custos); lucro, receita e
  cascata do DRE; caixa e fôlego do Fluxo — cada conceito tem uma fonte só.
- **Ambiguidade:** mês atual tem regra explícita (tendência e ponto projetado); fôlego arredonda
  para baixo; pilar sem dado sai da média.
- **Escopo:** uma rota de composição e uma regra pura — cabe num plano.
