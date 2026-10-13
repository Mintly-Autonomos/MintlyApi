# Fatia 8 — Visão Geral — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo: teste que falha → ver
> falhar → mínimo → ver passar → commit.

**Goal:** `GET /dashboard/overview?month=` com os cards, o score de saúde, "O que fazer primeiro",
Receita × Despesa e a cascata do lucro, compondo os relatórios que já existem.

**Architecture:** contrato aditivo na lib (tipos + `DashboardClient`); na API, `src/app/dashboard/`
com uma regra pura (`computeOverview`) sobre os três relatórios (`ResultReport`, `CashFlowReport`
de 30 dias, `ExpensesReport`) e uma consulta que os executa em paralelo com o mesmo relógio.

**Tech Stack:** TypeScript, Fastify 5, MongoDB, Jest (lib), Vitest (API).

**Spec:** `specs/modulos-novos/20261013/visao-geral.md` (aprovada em 13/10/2026).

## Global Constraints

- Nomes em inglês; commits em PT com rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura ≥ 90% (`npm run test:ci`). Lib: `feat` **sem** `!`.
- Pesos (palpite N5): `netMargin 0.30 · runway 0.30 · primeCost 0.25 · revenueTrend 0.15`; pontas `netMargin 0→0, 0.10→100 · runway 0→0, 45→100 · primeCost 0.85→0, 0.65→100 · revenueTrend −0.20→0, 0→100`; faixas 40 / 70.
- Pilar sem dado sai e os pesos se redistribuem; nenhum → `score: null`, `label: 'noData'`.
- Insights: ordem warning → positive → info, depois a do catálogo; máximo 4.
- Fôlego em dias inteiros (para baixo), em centavos; média 0 → `null`; caixa ≤ 0 → 0.
- Blocos de caixa sempre de hoje; o resto do mês consultado.
- Branches `feat/20261013/visao-geral` nos dois repositórios (a da API já existe).

## Review Focus

1. **Restaurante sem nenhum lançamento** — 200, `score: null`, `label: 'noData'`, sem `NaN`. → Tarefa 2 e 3.
2. **Mês corrente no dia 1** — a tendência usa a receita projetada (×dias do mês), sem divisão por zero. → Tarefa 2.
3. **Caixa negativo** — fôlego 0, não negativo. → Tarefa 2.
4. **Os mesmos números das telas de origem** — lucro/receita/cascata = DRE, CMV/prime = Custos, caixa = Fluxo. → Tarefa 3.
5. **`month` inválido ou futuro** — 400 (não 500 do `Promise.all`). → Tarefa 3.

---

## Cenário de conferência (entradas montadas; M = 2026-07, hoje = 10/08/2026)

| Fonte | Valores |
|---|---|
| DRE | receita 58.400 (Δ +7,7%), impostos 3.504, CMV 21.024, despesas 27.500, lucro 6.372 (Δ +24,9%), margem 6.372/58.400; `reachedOnDay` 19; histórico fev–jul receita 45.000 · 47.000 · 50.000 · 52.000 · 54.200 · 58.400 |
| Fluxo | caixa hoje 18.500; média diária de saída 925; saldo em 30 dias 3.900; menor saldo 900 em 22/08; `criticalDay` em 22/08 |
| Custos | receita 58.400 (ant. 54.200); CMV 21.024 (ant. 18.000); pessoal 8.000 (ant. 8.000); prime cost 29.024; histórico de despesa 40.000 · 42.000 · 44.000 · 46.000 · 49.100 · 52.000; anomalia Embalagens +900 (+60%) em CMV / Insumos |

Esperado: fôlego 20 dias · CMV 36% (ant. 33,21%, +2,79 p.p.) · prime cost 49,70% (ant. 47,97%) ·
pilares: margem 100, fôlego 44,44, prime cost 100, tendência 100 (58.400 contra a média de abr–jun,
52.066,67) → **score 83, healthy** · insights: `cashTight`, `cmvAboveTarget` (impacto 584),
`expenseAnomaly`, `breakEvenReached`.

---

## Tarefa 1 — MintlyLib: contrato e `DashboardClient`

**Branch:** `git checkout staging && git pull && git checkout -b feat/20261013/visao-geral`

**Files:** Create `src/core/data/reports/overview-response.ts`, `src/clients/dashboard-client.ts`, `src/clients/dashboard-client.spec.ts`; Modify `src/core/data/reports/index.ts`, `src/core/data/reports/index.spec.ts`, `src/clients/index.ts`, `src/clients/client-shape.spec.ts`, `src/core/client/master-client.ts`.

**Interfaces — Produces:** `OverviewQuery`, `OverviewReport`, `OverviewCards`, `HealthLabel`, `HealthPillarKey`, `HealthPillar`, `OverviewHealth`, `OverviewInsight`, `RevenueVsExpensePoint`, `ProfitWaterfall`; `DashboardClient.overview(query, headers)`; `MasterClient.dashboardClient`.

- [ ] **Passo 1: Testes que falham** — `dashboard-client.spec.ts`:

```ts
import { DashboardClient } from './dashboard-client'

describe('DashboardClient', () => {
  beforeAll(() => { process.env.BACK_END_URL = 'http://api.test' })

  it('overview faz GET /overview com o mês na query e devolve o envelope', async () => {
    const client = new DashboardClient()
    const get = jest.spyOn((client as any).http.connection, 'get').mockResolvedValue({ data: { payload: { referenceMonth: '2026-07' } } } as any)

    const res = await client.overview({ month: '2026-07' }, { env: 'staging', authorization: 'Bearer t' } as any)

    expect(get).toHaveBeenCalledWith('/overview', expect.objectContaining({ params: { month: '2026-07' } }))
    expect(res.payload).toEqual({ referenceMonth: '2026-07' })
  })
})
```

Em `client-shape.spec.ts` (importe `DashboardClient`), dentro do `describe`:

```ts
  it('DashboardClient: só a Visão Geral; sem CRUD genérico', () => {
    const c = new DashboardClient() as any
    expect(typeof c.overview).toBe('function')
    expect(c.insert).toBeUndefined()
    expect(c.findAll).toBeUndefined()
  })
```

Em `reports/index.spec.ts`, novo `it`:

```ts
  it('exporta os tipos da Visão Geral (fatia 8)', () => {
    const pillar: reports.HealthPillar = { key: 'runway', weight: 0.3, score: 44.4, value: 20 }
    const insight: reports.OverviewInsight = { kind: 'breakEvenReached', severity: 'positive', day: 19 }
    const label: reports.HealthLabel = 'noData'
    const query: reports.OverviewQuery = { month: '2026-07' }
    expect([pillar.key, insight.kind, label, query.month]).toEqual(['runway', 'breakEvenReached', 'noData', '2026-07'])
  })
```

- [ ] **Passo 2: Ver falhar** — `npx jest src/clients src/core/data/reports` → FAIL (módulos/tipos não existem).

- [ ] **Passo 3: Tipos** — `overview-response.ts`:

```ts
/**
 * Contrato de GET /dashboard/overview (fatia 8). Composição dos relatórios do
 * mês (DRE, Custos) e de hoje (Fluxo de Caixa). Frações como no resto
 * (0.36 = 36%); `deltaPoints` em pontos percentuais (2.8 = +2,8 p.p.). Spec:
 * MintlyApi/specs/modulos-novos/20261013/visao-geral.md.
 */

/** `month` em AAAA-MM (padrão: mês corrente). Os blocos de caixa são sempre de hoje. */
export interface OverviewQuery {
  month?: string
}

export interface OverviewCards {
  netProfit: { amount: number; delta: number | null; history: { month: string; amount: number }[] }
  revenue: { amount: number; delta: number | null; history: { month: string; amount: number }[] }
  cashToday: { amount: number; realized: { date: string; balance: number }[] }
  /** `runwayDays`: fôlego — caixa de hoje ÷ despesa média diária (dias inteiros). */
  projection: { horizon: number; balance: number; lowest: { date: string; balance: number }; runwayDays: number | null }
  cmv: { pct: number | null; previousPct: number | null; deltaPoints: number | null; target: { min: number; max: number } }
  primeCost: { pct: number | null; previousPct: number | null; deltaPoints: number | null; targetMax: number }
}

export type HealthLabel = 'risk' | 'attention' | 'healthy' | 'noData'
export type HealthPillarKey = 'netMargin' | 'runway' | 'primeCost' | 'revenueTrend'

/** Pilar do score (N5 — palpite). `score` null = sem dado (fora da média). */
export interface HealthPillar {
  key: HealthPillarKey
  weight: number
  score: number | null
  value: number | null
}

export interface OverviewHealth {
  score: number | null
  label: HealthLabel
  pillars: HealthPillar[]
  bands: { risk: number; attention: number }
}

export type OverviewInsight =
  | { kind: 'cashTight'; severity: 'warning'; date: string; balance: number }
  | { kind: 'cmvAboveTarget'; severity: 'warning'; pct: number; targetMax: number; impact: number }
  | { kind: 'primeCostAboveTarget'; severity: 'warning'; pct: number; targetMax: number }
  | { kind: 'expenseAnomaly'; severity: 'warning'; name: string; categoryName: string; excess: number; pctAbove: number }
  | { kind: 'breakEvenReached'; severity: 'positive'; day: number }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

export interface RevenueVsExpensePoint {
  month: string
  revenue: number
  expense: number
  /** true = projeção linear do mês atual (o ponto real do mesmo mês vem antes). */
  projected: boolean
}

export interface ProfitWaterfall {
  grossRevenue: number
  taxes: number
  cmv: number
  operatingExpenses: number
  netProfit: number
}

export interface OverviewReport {
  referenceMonth: string
  /** AAAA-MM-DD em SP — referência dos blocos de caixa. */
  today: string
  cards: OverviewCards
  health: OverviewHealth
  /** No máximo 4: warning → positive → info. */
  insights: OverviewInsight[]
  revenueVsExpense: RevenueVsExpensePoint[]
  profitWaterfall: ProfitWaterfall
}
```

`reports/index.ts`: `export * from './overview-response'`.

- [ ] **Passo 4: Client** — `dashboard-client.ts`:

```ts
import { ResponseDto, withHeaders } from '../core'
import { HttpBaseClient } from '../core/client/http-base-client'
import type { Headers } from '../core/data/request/headers'
import type { OverviewQuery, OverviewReport } from '../core/data/reports/overview-response'

/**
 * Visão Geral (fatia 8) — rota própria em /dashboard. Só GET; compõe o
 * HttpBaseClient pela conexão, como o ReportClient.
 */
export class DashboardClient {
  private readonly http = new HttpBaseClient<OverviewReport>('dashboard')

  /** Cards, score de saúde, "O que fazer primeiro", Receita × Despesa e cascata do lucro. */
  async overview (query: OverviewQuery, headers: Headers): Promise<ResponseDto<OverviewReport>> {
    const response = await this.http.connection.get<ResponseDto<OverviewReport>>('/overview', withHeaders(headers, { params: query }))
    return response.data
  }
}
```

`clients/index.ts`: `export { DashboardClient } from './dashboard-client'`. `MasterClient`: importe
`DashboardClient`, campo `dashboardClient: DashboardClient` e `this.dashboardClient = new DashboardClient()`.

- [ ] **Passo 5: Ver passar + checagens** — `npx jest && npm run typecheck && npm run lint && npm run build` → verde.

- [ ] **Passo 6: Commit e push** — `git add src && git commit -m "feat(reports): contrato e client da visao geral" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin feat/20261013/visao-geral`

---

## Tarefa 2 — MintlyApi: regra pura e cenário

**Files:** Create `src/app/dashboard/overview-metrics.ts` (+ `.spec.ts`), `src/app/dashboard/overview-scenario.ts`.

**Interfaces — Consumes:** tipos da T1; `project`/`projectionWindow` (`reports/expenses/expenses-detail.ts`); `addMonths` (`reports/shared/period.ts`); `toCents`/`fromCents`.
**Produces:**

```ts
export const HEALTH_WEIGHTS: Record<HealthPillarKey, number>
export const PILLAR_RANGES: Record<HealthPillarKey, { zero: number; full: number }>
export const HEALTH_BANDS = { risk: 40, attention: 70 }
export const OVERVIEW_HORIZON = 30
export const MAX_INSIGHTS = 4
export interface OverviewInput { result: ResultReport; cashFlow: CashFlowReport; expenses: ExpensesReport; today: Date }
export function pillarScore (key: HealthPillarKey, value: number | null): number | null
export function healthScore (pillars: HealthPillar[]): number | null
export function healthLabel (score: number | null): HealthLabel
export function runwayDays (cashToday: number, avgDailyOutflow: number): number | null
export function revenueTrend (base: number, history: { month: string; grossRevenue: number }[], month: string): number | null
export function computeOverview (input: OverviewInput): OverviewReport
// overview-scenario.ts
export const OVERVIEW_MONTH = '2026-07'
export const OVERVIEW_TODAY = new Date('2026-08-10T15:00:00Z')
export function overviewScenario (): OverviewInput
```

- [ ] **Passo 1: Build local da lib** — `cd ../MintlyLib && npm run build && cd ../MintlyApi && rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build` (não commitar).

- [ ] **Passo 2: Cenário** (dado de teste) — `overview-scenario.ts`:

```ts
import { CashFlowReport, ExpensesReport, ResultReport } from 'mintly-lib'
import { OverviewInput } from './overview-metrics'

/**
 * Entradas da Visão Geral montadas à mão (relatórios já calculados), M = 2026-07,
 * hoje = 10/08/2026 (mês fechado). Esperados no plano
 * (specs/modulos-novos/20261013/plan-visao-geral.md, "Cenário").
 */
export const OVERVIEW_MONTH = '2026-07'
export const OVERVIEW_TODAY = new Date('2026-08-10T15:00:00Z')

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
const REVENUE = [45_000, 47_000, 50_000, 52_000, 54_200, 58_400]
const PROFIT = [3_000, 3_500, 4_200, 4_900, 5_100, 6_372]
const EXPENSE = [40_000, 42_000, 44_000, 46_000, 49_100, 52_000]

export function overviewScenario (): OverviewInput {
  const result = {
    referenceMonth: OVERVIEW_MONTH,
    previousMonth: '2026-06',
    current: { grossRevenue: 58_400, taxes: 3_504, netRevenue: 54_896, cmv: 21_024, grossMargin: 33_872, operatingExpenses: 27_500, netProfit: 6_372, netMargin: 6_372 / 58_400 },
    previous: { grossRevenue: 54_200, taxes: 3_252, netRevenue: 50_948, cmv: 18_000, grossMargin: 32_948, operatingExpenses: 27_848, netProfit: 5_100, netMargin: 5_100 / 54_200 },
    deltas: { grossRevenue: 0.077, taxes: null, netRevenue: null, cmv: null, grossMargin: null, operatingExpenses: null, netProfit: 0.249 },
    tax: { regime: 'simplesNacionalAnexoI', effectiveRate: 0.06, meiMonthlyDas: null },
    operatingExpenseItems: [],
    breakEven: { fixedCosts: 15_200, variableCosts: 30_000, contributionMarginPct: 0.45, breakEvenRevenue: 30_470.96, reachedOnDay: 19 },
    history: MONTHS.map((month, i) => ({ month, grossRevenue: REVENUE[i], netProfit: PROFIT[i], netMargin: PROFIT[i] / REVENUE[i] })),
    insights: [],
  } as unknown as ResultReport

  const cashFlow = {
    horizon: 30,
    today: '2026-08-10',
    cashToday: 18_500,
    receivable: 32_500,
    payable: 47_100,
    projectedBalance: 3_900,
    lowestBalance: { date: '2026-08-22', balance: 900 },
    overdue: { count: 0, receivable: 0, payable: 0 },
    safetyThreshold: { value: 6_475, days: 7, avgDailyOutflow: 925 },
    projection: [],
    realized: [{ date: '2026-08-09', balance: 18_100, inflows: 0, outflows: 0 }, { date: '2026-08-10', balance: 18_500, inflows: 400, outflows: 0 }],
    weeks: [],
    dueItems: [],
    insights: [{ kind: 'criticalDay', severity: 'warning', date: '2026-08-22', balance: 900, threshold: 6_475 }],
  } as unknown as CashFlowReport

  const item = (key: string, dreGroup: string, amount: number, previous: number) => ({ key, kind: 'category', categoryId: key, name: key, behavior: 'variable', dreGroup, amount, previous, average3: null, deltaPrevious: null, deltaAverage3: null, pctOfRevenue: null, subitems: [], hasAnomaly: false, history: [], projected: null })
  const expenses = {
    referenceMonth: OVERVIEW_MONTH,
    previousMonth: '2026-06',
    channel: null,
    revenue: { current: 58_400, previous: 54_200 },
    total: { current: 52_000, previous: 49_100, average3: null, deltaPrevious: null, deltaAverage3: null },
    cmv: { amount: 21_024, pctOfRevenue: 21_024 / 58_400, target: { min: 0.28, max: 0.35 } },
    primeCost: { amount: 29_024, cmv: 21_024, labor: 8_000, pctOfRevenue: 29_024 / 58_400, targetMax: 0.65 },
    platformFee: { amount: 0, previous: 0, deltaPrevious: null, deliveryRevenue: 0, pctOfDelivery: null },
    byBehavior: { fixed: 0, variable: 0, mixed: 0 },
    items: [item('cmv', 'cmv', 21_024, 18_000), item('pro', 'labor', 8_000, 8_000), item('alu', 'opex', 6_000, 6_000)],
    sharedExcluded: null,
    history: MONTHS.map((month, i) => ({ month, total: EXPENSE[i] })),
    anomalies: [{ itemKey: 'cmv', categoryId: 'cmv', categoryName: 'CMV / Insumos', subcategoryId: 's', subitemKey: 's', name: 'Embalagens', amount: 2_400, average3: 1_500, excess: 900, pctAbove: 0.6 }],
    projection: null,
    anomalyRule: { minPctAbove: 0.5, minExcess: 100, minHistoryMonths: 2 },
  } as unknown as ExpensesReport

  return { result, cashFlow, expenses, today: OVERVIEW_TODAY }
}
```

- [ ] **Passo 3: Testes que falham** — `overview-metrics.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HealthPillar } from 'mintly-lib'
import { computeOverview, healthLabel, healthScore, pillarScore, revenueTrend, runwayDays } from './overview-metrics'
import { OVERVIEW_MONTH, overviewScenario } from './overview-scenario'

describe('pillarScore (linear, limitado a 0..100)', () => {
  it.each([
    ['netMargin', 0, 0], ['netMargin', 0.05, 50], ['netMargin', 0.10, 100], ['netMargin', 0.2, 100], ['netMargin', -0.1, 0],
    ['runway', 0, 0], ['runway', 22.5, 50], ['runway', 45, 100], ['runway', 90, 100],
    ['primeCost', 0.85, 0], ['primeCost', 0.75, 50], ['primeCost', 0.65, 100], ['primeCost', 0.5, 100], ['primeCost', 0.95, 0],
    ['revenueTrend', -0.2, 0], ['revenueTrend', -0.1, 50], ['revenueTrend', 0, 100], ['revenueTrend', 0.3, 100],
  ] as const)('%s %s → %s', (key, value, expected) => expect(pillarScore(key, value)).toBeCloseTo(expected, 10))
  it('sem valor → null', () => expect(pillarScore('runway', null)).toBeNull())
})

describe('healthScore e healthLabel', () => {
  const p = (key: HealthPillar['key'], weight: number, score: number | null): HealthPillar => ({ key, weight, score, value: null })
  it('média ponderada arredondada', () => {
    expect(healthScore([p('netMargin', 0.3, 100), p('runway', 0.3, 44.444), p('primeCost', 0.25, 100), p('revenueTrend', 0.15, 100)])).toBe(83)
  })
  it('pilar sem dado sai e os pesos se redistribuem', () => {
    expect(healthScore([p('netMargin', 0.3, 100), p('runway', 0.3, null), p('primeCost', 0.25, 0), p('revenueTrend', 0.15, null)])).toBe(55)
  })
  it('nenhum pilar → null', () => expect(healthScore([p('netMargin', 0.3, null)])).toBeNull())
  it.each([[null, 'noData'], [39, 'risk'], [40, 'attention'], [69, 'attention'], [70, 'healthy'], [100, 'healthy']] as const)('%s → %s', (score, label) => expect(healthLabel(score)).toBe(label))
})

describe('runwayDays', () => {
  it('dias inteiros para baixo', () => {
    expect(runwayDays(18_500, 925)).toBe(20)
    expect(runwayDays(18_500, 600)).toBe(30)
  })
  it('média 0 → null; caixa ≤ 0 → 0', () => {
    expect(runwayDays(5_000, 0)).toBeNull()
    expect(runwayDays(-300, 925)).toBe(0)
    expect(runwayDays(0, 925)).toBe(0)
  })
})

describe('revenueTrend', () => {
  const h = (values: number[]) => ['2026-04', '2026-05', '2026-06', '2026-07'].map((month, i) => ({ month, grossRevenue: values[i] }))
  it('contra a média dos 3 anteriores com receita', () => {
    expect(revenueTrend(58_400, h([50_000, 52_000, 54_200, 58_400]), '2026-07')).toBeCloseTo(58_400 / (156_200 / 3) - 1, 10)
  })
  it('ignora mês sem receita na média', () => {
    expect(revenueTrend(12_000, h([0, 10_000, 0, 12_000]), '2026-07')).toBeCloseTo(0.2, 10)
  })
  it('nenhum mês anterior com receita → null', () => expect(revenueTrend(12_000, h([0, 0, 0, 12_000]), '2026-07')).toBeNull())
})

describe('computeOverview — cenário (mês fechado)', () => {
  const r = computeOverview(overviewScenario())

  it('cabeçalho e cards do mês', () => {
    expect(r).toMatchObject({ referenceMonth: OVERVIEW_MONTH, today: '2026-08-10' })
    expect(r.cards.netProfit).toMatchObject({ amount: 6_372, delta: 0.249 })
    expect(r.cards.netProfit.history.map((x) => x.amount)).toEqual([3_000, 3_500, 4_200, 4_900, 5_100, 6_372])
    expect(r.cards.revenue).toMatchObject({ amount: 58_400, delta: 0.077 })
    expect(r.cards.revenue.history.at(-1)).toEqual({ month: '2026-07', amount: 58_400 })
  })

  it('cards de hoje: caixa, projeção e fôlego', () => {
    expect(r.cards.cashToday).toEqual({ amount: 18_500, realized: [{ date: '2026-08-09', balance: 18_100 }, { date: '2026-08-10', balance: 18_500 }] })
    expect(r.cards.projection).toEqual({ horizon: 30, balance: 3_900, lowest: { date: '2026-08-22', balance: 900 }, runwayDays: 20 })
  })

  it('CMV e prime cost com pontos percentuais', () => {
    expect(r.cards.cmv.pct).toBeCloseTo(0.36, 10)
    expect(r.cards.cmv.previousPct).toBeCloseTo(18_000 / 54_200, 10)
    expect(r.cards.cmv.deltaPoints).toBeCloseTo((0.36 - 18_000 / 54_200) * 100, 10)
    expect(r.cards.cmv.target).toEqual({ min: 0.28, max: 0.35 })
    expect(r.cards.primeCost.pct).toBeCloseTo(29_024 / 58_400, 10)
    expect(r.cards.primeCost.previousPct).toBeCloseTo(26_000 / 54_200, 10)
    expect(r.cards.primeCost.targetMax).toBe(0.65)
  })

  it('score 83, healthy, com os quatro pilares', () => {
    expect(r.health).toMatchObject({ score: 83, label: 'healthy', bands: { risk: 40, attention: 70 } })
    const byKey = Object.fromEntries(r.health.pillars.map((pl) => [pl.key, pl]))
    expect(byKey.netMargin).toMatchObject({ weight: 0.3, score: 100 })
    expect(byKey.runway).toMatchObject({ weight: 0.3, value: 20 })
    expect(byKey.runway.score).toBeCloseTo(44.444, 2)
    expect(byKey.primeCost).toMatchObject({ weight: 0.25, score: 100 })
    expect(byKey.revenueTrend).toMatchObject({ weight: 0.15, score: 100 })
    expect(byKey.revenueTrend.value).toBeCloseTo(58_400 / (156_200 / 3) - 1, 10)
  })

  it('insights na ordem e com os números', () => {
    expect(r.insights).toEqual([
      { kind: 'cashTight', severity: 'warning', date: '2026-08-22', balance: 900 },
      { kind: 'cmvAboveTarget', severity: 'warning', pct: 21_024 / 58_400, targetMax: 0.35, impact: 584 },
      { kind: 'expenseAnomaly', severity: 'warning', name: 'Embalagens', categoryName: 'CMV / Insumos', excess: 900, pctAbove: 0.6 },
      { kind: 'breakEvenReached', severity: 'positive', day: 19 },
    ])
  })

  it('Receita × Despesa (6 meses, sem ponto projetado) e cascata', () => {
    expect(r.revenueVsExpense).toHaveLength(6)
    expect(r.revenueVsExpense.at(-1)).toEqual({ month: '2026-07', revenue: 58_400, expense: 52_000, projected: false })
    expect(r.profitWaterfall).toEqual({ grossRevenue: 58_400, taxes: 3_504, cmv: 21_024, operatingExpenses: 27_500, netProfit: 6_372 })
  })
})

describe('computeOverview — bordas', () => {
  it('máximo 4 insights; prime cost acima entra antes da anomalia e info fica de fora', () => {
    const input = overviewScenario()
    ;(input.expenses.primeCost as any).pctOfRevenue = 0.7
    ;(input.result as any).insights = [{ kind: 'taxRegimeNotConfigured', severity: 'info' }]
    expect(computeOverview(input).insights.map((i) => i.kind)).toEqual(['cashTight', 'cmvAboveTarget', 'primeCostAboveTarget', 'expenseAnomaly'])
  })

  it('só positivos e info: ordem positive → info', () => {
    const input = overviewScenario()
    ;(input.cashFlow as any).insights = []
    ;(input.expenses.cmv as any).pctOfRevenue = 0.3
    ;(input.expenses as any).anomalies = []
    ;(input.result as any).insights = [{ kind: 'taxRegimeNotConfigured', severity: 'info' }]
    expect(computeOverview(input).insights.map((i) => i.kind)).toEqual(['breakEvenReached', 'taxRegimeNotConfigured'])
  })

  it('mês atual no dia 10: tendência e ponto projetado usam a receita projetada', () => {
    const input = overviewScenario()
    input.today = new Date('2026-07-10T15:00:00Z')
    ;(input.result.current as any).grossRevenue = 10_000
    ;(input.result as any).history = ['2026-04', '2026-05', '2026-06', '2026-07'].map((month, i) => ({ month, grossRevenue: [30_000, 30_000, 30_000, 10_000][i], netProfit: 0, netMargin: null }))
    ;(input.expenses as any).projection = { total: 40_000, elapsedDays: 10, daysInMonth: 31 }
    const r = computeOverview(input)
    const trend = r.health.pillars.find((pl) => pl.key === 'revenueTrend')!
    expect(trend.value).toBeCloseTo(31_000 / 30_000 - 1, 10)
    expect(trend.score).toBe(100)
    expect(r.revenueVsExpense.at(-1)).toEqual({ month: '2026-07', revenue: 31_000, expense: 40_000, projected: true })
  })

  it('mês atual no dia 1: projeta ×dias do mês, sem divisão por zero', () => {
    const input = overviewScenario()
    input.today = new Date('2026-07-01T15:00:00Z')
    ;(input.result.current as any).grossRevenue = 1_000
    const trend = computeOverview(input).health.pillars.find((pl) => pl.key === 'revenueTrend')!
    expect(trend.value).toBeCloseTo(31_000 / (156_200 / 3) - 1, 10)
  })

  it('restaurante sem dados: score null, noData, nada de NaN', () => {
    const input = overviewScenario()
    ;(input.result as any).current = { grossRevenue: 0, taxes: 0, netRevenue: 0, cmv: 0, grossMargin: 0, operatingExpenses: 0, netProfit: 0, netMargin: null }
    ;(input.result as any).history = []
    ;(input.result as any).breakEven = { fixedCosts: 0, variableCosts: 0, contributionMarginPct: null, breakEvenRevenue: null, reachedOnDay: null }
    ;(input.cashFlow as any).safetyThreshold = { value: 0, days: 7, avgDailyOutflow: 0 }
    ;(input.cashFlow as any).insights = []
    ;(input.expenses as any).cmv = { amount: 0, pctOfRevenue: null, target: { min: 0.28, max: 0.35 } }
    ;(input.expenses as any).primeCost = { amount: 0, cmv: 0, labor: 0, pctOfRevenue: null, targetMax: 0.65 }
    ;(input.expenses as any).revenue = { current: 0, previous: 0 }
    ;(input.expenses as any).anomalies = []
    const r = computeOverview(input)
    expect(r.health).toMatchObject({ score: null, label: 'noData' })
    expect(r.cards.cmv).toMatchObject({ pct: null, previousPct: null, deltaPoints: null })
    expect(r.cards.projection.runwayDays).toBeNull()
    expect(r.insights).toEqual([])
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })

  it('caixa negativo: fôlego 0 e pilar com nota 0', () => {
    const input = overviewScenario()
    ;(input.cashFlow as any).cashToday = -2_000
    const r = computeOverview(input)
    expect(r.cards.projection.runwayDays).toBe(0)
    expect(r.health.pillars.find((pl) => pl.key === 'runway')!.score).toBe(0)
  })
})
```

- [ ] **Passo 4: Ver falhar** — `npx vitest run src/app/dashboard` → FAIL (`overview-metrics` não existe).

- [ ] **Passo 5: Implementar** — `overview-metrics.ts`:

```ts
import {
  CashFlowReport, DreGroup, ExpensesReport, HealthLabel, HealthPillar, HealthPillarKey,
  OverviewInsight, OverviewReport, ResultReport,
} from 'mintly-lib'
import { fromCents, toCents } from '../../core/money/money'
import { addMonths } from '../reports/shared/period'
import { project, projectionWindow } from '../reports/expenses/expenses-detail'

/**
 * Visão Geral (fatia 8, spec 20261013/visao-geral.md) — composição pura dos
 * relatórios do mês (DRE, Custos) e de hoje (Fluxo de Caixa).
 *
 * Score de saúde: pesos, pontas e faixas são PROPOSTA do design — a MIN-83 não
 * os define (pendência N5). Ajuste aqui.
 */
export const HEALTH_WEIGHTS: Record<HealthPillarKey, number> = { netMargin: 0.30, runway: 0.30, primeCost: 0.25, revenueTrend: 0.15 }
/** Valor que dá nota 0 e valor que dá nota 100 (linear entre os dois). */
export const PILLAR_RANGES: Record<HealthPillarKey, { zero: number; full: number }> = {
  netMargin: { zero: 0, full: 0.10 },
  runway: { zero: 0, full: 45 },
  primeCost: { zero: 0.85, full: 0.65 },
  revenueTrend: { zero: -0.20, full: 0 },
}
export const HEALTH_BANDS = { risk: 40, attention: 70 }
export const OVERVIEW_HORIZON = 30
export const MAX_INSIGHTS = 4

export interface OverviewInput {
  result: ResultReport
  cashFlow: CashFlowReport
  expenses: ExpensesReport
  today: Date
}

const PILLAR_ORDER: HealthPillarKey[] = ['netMargin', 'runway', 'primeCost', 'revenueTrend']
const SEVERITY_RANK: Record<OverviewInsight['severity'], number> = { warning: 0, positive: 1, info: 2 }

export function pillarScore (key: HealthPillarKey, value: number | null): number | null {
  if (value == null) return null
  const { zero, full } = PILLAR_RANGES[key]
  return Math.min(100, Math.max(0, ((value - zero) / (full - zero)) * 100))
}

/** Média ponderada dos pilares com nota (pesos redistribuídos); nenhum → null. */
export function healthScore (pillars: HealthPillar[]): number | null {
  const scored = pillars.filter((p) => p.score != null)
  if (scored.length === 0) return null
  const weight = scored.reduce((a, p) => a + p.weight, 0)
  return Math.round(scored.reduce((a, p) => a + p.weight * p.score!, 0) / weight)
}

export function healthLabel (score: number | null): HealthLabel {
  if (score == null) return 'noData'
  if (score < HEALTH_BANDS.risk) return 'risk'
  if (score < HEALTH_BANDS.attention) return 'attention'
  return 'healthy'
}

/** Fôlego: caixa ÷ despesa média diária, em dias inteiros (para baixo), em centavos. */
export function runwayDays (cashToday: number, avgDailyOutflow: number): number | null {
  if (avgDailyOutflow <= 0) return null
  if (cashToday <= 0) return 0
  return Math.floor(toCents(cashToday) / toCents(avgDailyOutflow))
}

/** (base − média dos meses M−1..M−3 com receita) / média; nenhum → null. */
export function revenueTrend (base: number, history: { month: string; grossRevenue: number }[], month: string): number | null {
  const previous = [1, 2, 3].map((i) => addMonths(month, -i))
  const values = history.filter((h) => previous.includes(h.month) && h.grossRevenue > 0).map((h) => h.grossRevenue)
  if (values.length === 0) return null
  const avg = values.reduce((a, v) => a + v, 0) / values.length
  return (base - avg) / avg
}

/** Σ do campo dos itens de Custos nos grupos ÷ receita; receita 0 → null. */
function groupPct (expenses: ExpensesReport, groups: DreGroup[], field: 'previous', revenue: number): number | null {
  if (revenue === 0) return null
  const cents = expenses.items.filter((i) => i.dreGroup != null && groups.includes(i.dreGroup)).reduce((a, i) => a + toCents(i[field]), 0)
  return cents / toCents(revenue)
}

const points = (pct: number | null, previous: number | null) => (pct == null || previous == null ? null : (pct - previous) * 100)

function buildInsights ({ result, cashFlow, expenses }: OverviewInput): OverviewInsight[] {
  const list: OverviewInsight[] = []
  const critical = cashFlow.insights.find((i) => i.kind === 'criticalDay')
  if (critical) list.push({ kind: 'cashTight', severity: 'warning', date: critical.date, balance: critical.balance })

  const cmvPct = expenses.cmv.pctOfRevenue
  const cmvMax = expenses.cmv.target.max
  if (cmvPct != null && cmvPct > cmvMax) {
    list.push({ kind: 'cmvAboveTarget', severity: 'warning', pct: cmvPct, targetMax: cmvMax, impact: fromCents(Math.round((cmvPct - cmvMax) * toCents(expenses.revenue.current))) })
  }
  const primePct = expenses.primeCost.pctOfRevenue
  if (primePct != null && primePct > expenses.primeCost.targetMax) {
    list.push({ kind: 'primeCostAboveTarget', severity: 'warning', pct: primePct, targetMax: expenses.primeCost.targetMax })
  }
  const anomaly = expenses.anomalies[0]
  if (anomaly) list.push({ kind: 'expenseAnomaly', severity: 'warning', name: anomaly.name, categoryName: anomaly.categoryName, excess: anomaly.excess, pctAbove: anomaly.pctAbove })
  if (result.breakEven.reachedOnDay != null) list.push({ kind: 'breakEvenReached', severity: 'positive', day: result.breakEven.reachedOnDay })
  if (result.insights.some((i) => i.kind === 'taxRegimeNotConfigured')) list.push({ kind: 'taxRegimeNotConfigured', severity: 'info' })

  // sort é estável: dentro da mesma severidade fica a ordem do catálogo.
  return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, MAX_INSIGHTS)
}

export function computeOverview (input: OverviewInput): OverviewReport {
  const { result, cashFlow, expenses, today } = input
  const month = result.referenceMonth
  const window = projectionWindow(month, today)
  // Mês atual: receita projetada (linear) — senão o mês pela metade sempre "cai".
  const revenueBase = window ? fromCents(project(toCents(result.current.grossRevenue), window)) : result.current.grossRevenue

  const runway = runwayDays(cashFlow.cashToday, cashFlow.safetyThreshold.avgDailyOutflow)
  const values: Record<HealthPillarKey, number | null> = {
    netMargin: result.current.netMargin,
    runway,
    primeCost: expenses.primeCost.pctOfRevenue,
    revenueTrend: revenueTrend(revenueBase, result.history, month),
  }
  const pillars: HealthPillar[] = PILLAR_ORDER.map((key) => ({ key, weight: HEALTH_WEIGHTS[key], score: pillarScore(key, values[key]), value: values[key] }))
  const score = healthScore(pillars)

  const cmvPrev = groupPct(expenses, [DreGroup.Cmv], 'previous', expenses.revenue.previous)
  const primePrev = groupPct(expenses, [DreGroup.Cmv, DreGroup.Labor], 'previous', expenses.revenue.previous)
  const expenseByMonth = new Map(expenses.history.map((h) => [h.month, h.total]))

  const revenueVsExpense = result.history.map((h) => ({ month: h.month, revenue: h.grossRevenue, expense: expenseByMonth.get(h.month) ?? 0, projected: false }))
  if (window) revenueVsExpense.push({ month, revenue: revenueBase, expense: expenses.projection?.total ?? expenses.total.current, projected: true })

  return {
    referenceMonth: month,
    today: cashFlow.today,
    cards: {
      netProfit: { amount: result.current.netProfit, delta: result.deltas.netProfit, history: result.history.map((h) => ({ month: h.month, amount: h.netProfit })) },
      revenue: { amount: result.current.grossRevenue, delta: result.deltas.grossRevenue, history: result.history.map((h) => ({ month: h.month, amount: h.grossRevenue })) },
      cashToday: { amount: cashFlow.cashToday, realized: cashFlow.realized.map((p) => ({ date: p.date, balance: p.balance })) },
      projection: { horizon: cashFlow.horizon, balance: cashFlow.projectedBalance, lowest: cashFlow.lowestBalance, runwayDays: runway },
      cmv: { pct: expenses.cmv.pctOfRevenue, previousPct: cmvPrev, deltaPoints: points(expenses.cmv.pctOfRevenue, cmvPrev), target: expenses.cmv.target },
      primeCost: { pct: expenses.primeCost.pctOfRevenue, previousPct: primePrev, deltaPoints: points(expenses.primeCost.pctOfRevenue, primePrev), targetMax: expenses.primeCost.targetMax },
    },
    health: { score, label: healthLabel(score), pillars, bands: HEALTH_BANDS },
    insights: buildInsights(input),
    revenueVsExpense,
    profitWaterfall: {
      grossRevenue: result.current.grossRevenue,
      taxes: result.current.taxes,
      cmv: result.current.cmv,
      operatingExpenses: result.current.operatingExpenses,
      netProfit: result.current.netProfit,
    },
  }
}
```

- [ ] **Passo 6: Ver passar** — `npx vitest run src/app/dashboard` → PASS. `npx tsc --noEmit` e `npx eslint --fix src/app/dashboard` → limpos.

- [ ] **Passo 7: Commit** — `git add src/app/dashboard && git commit -m "feat(dashboard): regras da visao geral e score de saude" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 3 — Consulta, rota e integração

**Files:** Create `src/app/dashboard/use-cases/overview.query.ts`, `overview-controller.ts`, `overview-routes.ts`, `overview.int.spec.ts`; Modify `src/infrastructure/server/build-server.ts`.

**Interfaces — Consumes:** `computeOverview`, `OVERVIEW_HORIZON` (T2); `ResultQuery(repo?, restaurants?, taxRepo?, settings?, clock?)`, `CashFlowQuery(repo?, clock?)`, `ExpensesQuery(repo?, taxRepo?, clock?)`.

- [ ] **Passo 1: Testes de integração que falham** — `overview.int.spec.ts` (mesmo `beforeAll`/`afterAll`/`signup` do `result.int.spec.ts`, prefixo `int_overview_`, `M = addMonths(toLocalMonth(new Date()), -1)`; imports `resultScenario` de `../reports/result/result-scenario`, `toDecimal128`, `ObjectId`):

```ts
  async function plant (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const { categories, movements } = resultScenario(M, restaurantId)
    await db.collection('financial_categories').insertMany(categories)
    await db.collection('financial_movements').insertMany(movements)
    await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })
  }
  const getJson = async (auth: Record<string, string>, url: string) => (await app.inject({ method: 'GET', url, headers: auth })).json().payload

  it('mesmos números das telas de origem (DRE, Custos, Fluxo)', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const [o, result, expenses, cash] = await Promise.all([
      getJson(auth, `/dashboard/overview?month=${M}`),
      getJson(auth, `/reports/result?month=${M}`),
      getJson(auth, `/reports/expenses?month=${M}`),
      getJson(auth, '/reports/cash-flow?horizon=30'),
    ])

    expect(o.referenceMonth).toBe(M)
    expect(o.cards.netProfit.amount).toBe(result.current.netProfit)
    expect(o.cards.revenue.amount).toBe(result.current.grossRevenue)
    expect(o.profitWaterfall).toEqual({ grossRevenue: result.current.grossRevenue, taxes: result.current.taxes, cmv: result.current.cmv, operatingExpenses: result.current.operatingExpenses, netProfit: result.current.netProfit })
    expect(o.cards.cmv.pct).toBe(expenses.cmv.pctOfRevenue)
    expect(o.cards.primeCost.pct).toBe(expenses.primeCost.pctOfRevenue)
    expect(o.cards.cashToday.amount).toBe(cash.cashToday)
    expect(o.cards.projection.balance).toBe(cash.projectedBalance)
    expect(o.revenueVsExpense.map((p: any) => p.revenue)).toEqual(result.history.map((h: any) => h.grossRevenue))
    expect(o.health.pillars.map((p: any) => p.key)).toEqual(['netMargin', 'runway', 'primeCost', 'revenueTrend'])
    expect(o.insights.some((i: any) => i.kind === 'breakEvenReached')).toBe(true)
  })

  it('restaurante sem lançamentos: 200, noData', async () => {
    const { auth } = await signup(freshEnv())
    const o = await getJson(auth, '/dashboard/overview')
    expect(o.health).toMatchObject({ score: null, label: 'noData' })
    expect(o.referenceMonth).toBe(toLocalMonth(new Date()))
    expect(JSON.stringify(o)).not.toMatch(/NaN|Infinity/)
  })

  it('mês atual com receita: ponto projetado em Receita × Despesa', async () => {
    const { auth, restaurantId } = await signup(freshEnv())
    const now = new Date()
    await mongoConnection.getDatabase(auth.env).collection('financial_movements').insertOne({
      restaurantId, title: 'Venda', direction: 'in', status: 'settled', statusSource: 'auto', date: now,
      grossValue: toDecimal128(1_000), feeValue: toDecimal128(0), netValue: toDecimal128(1_000),
      account: { _id: 'a', name: 'Caixa', type: 'cash' }, category: { _id: 'c', name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: now, updatedAt: now },
    })
    const o = await getJson(auth, '/dashboard/overview')
    expect(o.revenueVsExpense.at(-1)).toMatchObject({ month: toLocalMonth(now), projected: true })
  })

  it('dois restaurantes no mesmo ambiente não se misturam', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    await plant(env, a.restaurantId)
    const ob = await getJson(b.auth, `/dashboard/overview?month=${M}`)
    expect(ob.cards.revenue.amount).toBe(0)
  })

  it.each(['?month=2026-13', 'FUTURE'])('GET %s → 400', async (q) => {
    const { auth } = await signup(freshEnv())
    const query = q === 'FUTURE' ? `?month=${addMonths(M, 2)}` : q
    expect((await app.inject({ method: 'GET', url: `/dashboard/overview${query}`, headers: auth })).statusCode).toBe(400)
  })

  it('sem token → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/dashboard/overview', headers: { env: freshEnv() } })).statusCode).toBe(401)
  })
```

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/dashboard/overview.int.spec.ts` → FAIL (404).

- [ ] **Passo 3: Consulta, controller, rota** — `use-cases/overview.query.ts`:

```ts
import { OverviewReport } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { ResultQuery } from '../../reports/result/use-cases/result.query'
import { CashFlowQuery } from '../../reports/cash-flow/use-cases/cash-flow.query'
import { ExpensesQuery } from '../../reports/expenses/use-cases/expenses.query'
import { OVERVIEW_HORIZON, computeOverview } from '../overview-metrics'

/**
 * Visão Geral: roda DRE, Fluxo de Caixa (30 dias) e Custos em paralelo, com o
 * MESMO relógio, e entrega à regra pura. Mês inválido/futuro → 400 vindo das
 * próprias consultas. Read-only.
 */
export class OverviewQuery {
  private readonly result: ResultQuery
  private readonly cashFlow: CashFlowQuery
  private readonly expenses: ExpensesQuery

  constructor (private readonly clock: () => Date = () => new Date(), deps: { result?: ResultQuery; cashFlow?: CashFlowQuery; expenses?: ExpensesQuery } = {}) {
    this.result = deps.result ?? new ResultQuery(undefined, undefined, undefined, undefined, clock)
    this.cashFlow = deps.cashFlow ?? new CashFlowQuery(undefined, clock)
    this.expenses = deps.expenses ?? new ExpensesQuery(undefined, undefined, clock)
  }

  async execute (ctx: RequestContext, month?: string): Promise<OverviewReport> {
    const today = this.clock()
    const [result, cashFlow, expenses] = await Promise.all([
      this.result.execute(ctx, month),
      this.cashFlow.execute(ctx, OVERVIEW_HORIZON),
      this.expenses.execute(ctx, month),
    ])
    return computeOverview({ result, cashFlow, expenses, today })
  }
}
```

`overview-controller.ts`:

```ts
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { OverviewQuery } from './use-cases/overview.query'

export class OverviewController {
  constructor (private readonly query: OverviewQuery = new OverviewQuery()) {}

  /** GET /dashboard/overview?month=AAAA-MM */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const report = await this.query.execute(ctx, (request.query ?? {}).month)
    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
```

`overview-routes.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { OverviewController } from './overview-controller'

export async function overviewRoutes (fastify: FastifyInstance) {
  const controller = new OverviewController()

  // GET /dashboard/overview?month=AAAA-MM — fatia 8. Mês inválido/futuro → 400.
  fastify.get('/overview', async (request: any, reply) => controller.get(request, reply))
}
```

Em `build-server.ts`: importe `overviewRoutes` de `'../../app/dashboard/overview-routes'` e registre
`await protectedScope.register(overviewRoutes, { prefix: '/dashboard' })` depois de `expensesRoutes`.

- [ ] **Passo 4: Ver passar** — `npx vitest run src/app/dashboard` → PASS.

- [ ] **Passo 5: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 6: Commit** — `git add src/app/dashboard src/infrastructure/server/build-server.ts && git commit -m "feat(dashboard): GET /dashboard/overview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 4 — E2E e Insomnia

- [ ] **Passo 1: E2E** — `tests/e2e/overview.e2e.spec.ts` no padrão de `result.e2e.spec.ts` (signup no env `e2e`, `cashId`, `revenueCatId`, `cmvCatId`; `dropDatabase` no fim):

```ts
  it('lançamentos por HTTP real aparecem na Visão Geral', async () => {
    const post = (body: Record<string, unknown>) => fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ date: new Date().toISOString(), accountId: cashId, paymentMethod: 'pix', ...body }) })
    expect((await post({ direction: 'in', title: 'Vendas E2E', grossValue: 1000, categoryId: revenueCatId })).status).toBe(201)
    expect((await post({ direction: 'out', title: 'Insumos E2E', grossValue: 400, categoryId: cmvCatId })).status).toBe(201)

    const res = await fetch(`${baseUrl}/dashboard/overview`, { headers: auth })
    expect(res.status).toBe(200)
    const o = (await res.json() as any).payload
    expect(o.cards.revenue.amount).toBe(1000)
    expect(o.cards.cmv.pct).toBeCloseTo(0.4, 10)
    expect(o.insights.map((i: any) => i.kind)).toContain('cmvAboveTarget')
    expect(o.revenueVsExpense.at(-1)).toMatchObject({ projected: true })
  })
```

`npm run test:e2e` → verde.

- [ ] **Passo 2: Insomnia** — pasta `fld_dashboard` "Dashboard" com `req_overview` "Visão Geral", `GET {{ _.base_url }}/dashboard/overview`, headers `env` e `Authorization` como as outras; descrição "Fatia 8. ?month=AAAA-MM (padrão: mês corrente); caixa sempre de hoje. Score de saúde: palpite N5."; diff só acrescenta.

- [ ] **Passo 3: Commit** — `git add tests/e2e/overview.e2e.spec.ts insomnia/MintlyApi.insomnia_v4.json && git commit -m "test(dashboard): E2E da visao geral e insomnia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 5 — Fechar a fatia

- [ ] PR da lib (`feat(reports): visao geral`) → merge → `npm i mintly-lib@<versão>` na API → suíte → commit `chore(deps)`.
- [ ] `andamento.md` (fatia 8 em review; N5 segue aberto; Jira) → commit `docs(modulos-novos): andamento da fatia 8`.
- [ ] PR da API (`feat(dashboard): visao geral`) com contrato, regras, "nenhum comando novo"; `gh pr checks` verde.

---

## Self-review

- **Cobertura da spec:** contrato + client → T1; cada linha da tabela de regras (cards, fôlego, CMV/prime com pontos, quatro pilares, nota linear, score com redistribuição, rótulos, catálogo de insights com ordem e corte, Receita × Despesa com ponto projetado, cascata) → T2; composição com o mesmo relógio, rota, 400/401, consistência com as telas de origem, multi-tenant → T3; E2E e Insomnia → T4.
- **Placeholders:** nenhum.
- **Tipos:** `OverviewInput`/`computeOverview`/`OVERVIEW_HORIZON` (T2) em T3; tipos da T1 em T2.
- **Contas:** prime anterior = (18.000 + 8.000) / 54.200; score = round(0,3·100 + 0,3·44,44 + 0,25·100 + 0,15·100) = round(83,33) = 83; redistribuição = round((0,3·100 + 0,25·0) / 0,55) = round(54,55) = 55; impacto CMV = round((0,36 − 0,35) × 5.840.000 centavos) = 58.400 → 584; dia 1: 1.000 × 31 / 1 = 31.000.
- **Review Focus:** os cinco têm teste — sem dados (T2, T3), dia 1 (T2), caixa negativo (T2), números das telas de origem (T3), 400 (T3).
