# Fatia 7 — Custos & Despesas (fatia B) — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo: teste que falha → ver
> falhar → mínimo → ver passar → commit.

**Goal:** acrescentar ao `GET /reports/expenses` os subitens das categorias, as anomalias do mês
("Fique de olho" e selo), a série de 6 meses por item e a projeção linear do mês atual.

**Architecture:** contrato aditivo na lib; na API, regras pequenas e puras em `expenses-detail.ts`
(limiares, anomalia, projeção, ordem dos subitens) e o `computeExpenses` passando a acumular também
por subcategoria. O repositório agrupa por `subcategory._id`; a consulta passa o relógio.

**Tech Stack:** TypeScript, Fastify 5, MongoDB, Jest (lib), Vitest (API).

**Spec:** `specs/modulos-novos/20261013/custos-despesas-b.md` (aprovada em 13/10/2026).

## Global Constraints

- Nomes em inglês; commits em PT com rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura ≥ 90% (`npm run test:ci`). Lib: `feat` **sem** `!`.
- Somas em centavos; percentuais sem arredondar; projeção arredondada ao centavo.
- Anomalia: ≥ 2 meses elegíveis, média > 0, excedente ≥ R$ 100, excedente/média ≥ 0,5; só no mês consultado; compara o real; taxa de plataforma nunca.
- Projeção só quando o mês consultado é o mês atual em `America/Sao_Paulo`.
- Os números da fatia 6 não mudam.
- Branches `feat/20261013/custos-despesas-b` nos dois repositórios (a da API já existe).

## Review Focus

1. **Subitem com média zero (gasto novo)** — não é anomalia, sem divisão por zero. → Tarefa 2.
2. **22h do último dia do mês em SP** (já é dia 1 em UTC) — a projeção ainda é do mês consultado, com `elapsedDays` = último dia. → Tarefa 2.
3. **Categoria cujos lançamentos com subcategoria são só de outro canal** — no filtro, ela não tem subitens e é avaliada inteira. → Tarefa 2.
4. **Subcategoria renomeada** — o subitem mostra o nome atual, não o gravado. → Tarefa 2 e 3.
5. **Lançamento antigo sem o campo `subcategory`** — cai em "Sem subitem", não num grupo separado de `null` × ausente. → Tarefa 3.

---

## Cenário (relativo a M; os números da fatia 6 seguem iguais)

O CMV do cenário da fatia 6 passa a ser dividido em subcategorias (`sub-fra` Frango, `sub-ole` Óleo,
`sub-emb` Embalagens) e "Sem subitem":

| | M | M−1 | M−2 | M−3 |
|---|---|---|---|---|
| Frango | 6.000 | 5.500 | 5.000 | 5.000 |
| Óleo | 1.500 | 1.500 | 1.400 | 1.300 |
| Embalagens | 2.400 + 2.000 `delivery` | 1.500 | 1.600 | 1.400 |
| Sem subitem | 2.100 | 1.500 | 1.500 | 1.300 |
| **CMV** | 14.000 | 10.000 | 9.500 | 9.000 |

**Geral (M), subitens do CMV** (ordem): Frango 6.000 (ant. 5.500, média 5.166,67) · Embalagens 4.400
(1.500 / 1.500) · Óleo 1.500 (1.500 / 1.400) · Sem subitem 2.100 (1.500 / 1.433,33).

**Anomalias (Geral):** Embalagens — 4.400 contra 1.500, excedente 2.900, +193,3% · Marketing (categoria
sem subitens, avaliada inteira) — 800 contra 500, excedente 300, +60%. Não disparam: Frango (+16%),
Óleo (excedente 100 mas +7%), Sem subitem (+46,5%), Utilidades (+25%), Impostos (+29%), Motoboy
(média 0), Taxa iFood (+131%, mas taxa fica fora). `hasAnomaly`: CMV e Marketing.

**Delivery (M):** CMV tem um subitem só, Embalagens 2.000 (média 0); nenhuma anomalia.

**Projeção** (unitário, M = 2026-08): hoje 10/08 → `elapsedDays` 10, `daysInMonth` 31, total
32.300 × 31 / 10 = 100.130; CMV 43.400.

---

## Tarefa 1 — MintlyLib: contrato

**Branch:** `git checkout staging && git pull && git checkout -b feat/20261013/custos-despesas-b`

**Files:** Modify `src/core/data/reports/expenses-response.ts`, `src/core/data/reports/index.spec.ts`.

**Interfaces — Produces:** `ExpenseSubitem`, `ExpenseAnomaly`, `ExpensesProjection`, `ExpensesAnomalyRule`; `ExpenseItem.subitems/hasAnomaly/history/projected`; `ExpensesReport.anomalies/projection/anomalyRule`.

- [ ] **Passo 1: Teste que falha** — em `index.spec.ts`, troque o corpo por:

```ts
import type * as reports from './index'

// Contrato só de tipos: o teste é o typecheck destas atribuições.
describe('barrel de reports', () => {
  it('exporta os tipos de Custos & Despesas (fatias 6 e 7)', () => {
    const sub: reports.ExpenseSubitem = { key: 'none', subcategoryId: null, name: 'Sem subitem', amount: 1, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null, anomaly: false }
    const item: reports.ExpenseItem = {
      key: 'c1', kind: 'category', categoryId: 'c1', name: 'CMV', behavior: 'variable' as any, dreGroup: 'cmv' as any,
      amount: 1, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null, pctOfRevenue: null,
      subitems: [sub], hasAnomaly: false, history: [{ month: '2026-08', amount: 1 }], projected: null,
    }
    const anomaly: reports.ExpenseAnomaly = { itemKey: 'c1', categoryId: 'c1', categoryName: 'CMV', subcategoryId: null, subitemKey: 'none', name: 'Sem subitem', amount: 300, average3: 100, excess: 200, pctAbove: 2 }
    const rule: reports.ExpensesAnomalyRule = { minPctAbove: 0.5, minExcess: 100, minHistoryMonths: 2 }
    const projection: reports.ExpensesProjection = { total: 10, elapsedDays: 10, daysInMonth: 31 }
    const query: reports.ExpensesQuery = { month: '2026-08' }
    expect([item.subitems[0].key, anomaly.excess, rule.minExcess, projection.daysInMonth, query.month]).toEqual(['none', 200, 100, 31, '2026-08'])
  })
})
```

- [ ] **Passo 2: Ver falhar** — `npx jest src/core/data/reports` → FAIL (tipos não existem).

- [ ] **Passo 3: Tipos** — em `expenses-response.ts`, antes de `ExpenseItem`:

```ts
/** Subitem de uma categoria (fatia 7): uma subcategoria, ou "Sem subitem" (`key: 'none'`). */
export interface ExpenseSubitem {
  key: string
  subcategoryId: string | null
  /** Nome atual da subcategoria (mesmo inativa); "Sem subitem". */
  name: string
  amount: number
  previous: number
  average3: number | null
  deltaPrevious: number | null
  deltaAverage3: number | null
  anomaly: boolean
}
```

Em `ExpenseItem`, depois de `pctOfRevenue`:

```ts
  /** [] quando a categoria não tem lançamento com subcategoria na janela; taxa → []. */
  subitems: ExpenseSubitem[]
  /** Selo "alerta": a categoria inteira ou algum subitem dela é atípico no mês. */
  hasAnomaly: boolean
  /** 6 meses, do mais antigo ao mês de referência (gráfico "Por categoria"). */
  history: { month: string; amount: number }[]
  /** Projeção do mês atual; null em mês fechado. */
  projected: number | null
```

Em `ExpensesPlatformFee`, acima de `pctOfDelivery`:

```ts
  /** Taxa / Σ receita bruta das contas de plataforma (a taxa e a venda que a gerou no mesmo denominador). */
```

Depois de `ExpensesPlatformFee`:

```ts
/** Gasto atípico do mês ("Fique de olho"). Regra em `ExpensesReport.anomalyRule`. */
export interface ExpenseAnomaly {
  /** `ExpenseItem.key` da categoria. */
  itemKey: string
  categoryId: string | null
  categoryName: string
  subcategoryId: string | null
  /** `ExpenseSubitem.key`; null = a categoria inteira foi avaliada (sem subitens). */
  subitemKey: string | null
  name: string
  amount: number
  average3: number
  excess: number
  pctAbove: number
}

/** Projeção linear do mês atual: total até hoje × daysInMonth / elapsedDays. */
export interface ExpensesProjection {
  total: number
  elapsedDays: number
  daysInMonth: number
}

/** Critério de anomalia (N4 — palpite, ainda não validado pelo negócio). */
export interface ExpensesAnomalyRule {
  minPctAbove: number
  minExcess: number
  minHistoryMonths: number
}
```

Em `ExpensesReport`, depois de `history`:

```ts
  /** Maior excedente primeiro. Só o mês de referência. */
  anomalies: ExpenseAnomaly[]
  /** Só quando o mês de referência é o mês atual. */
  projection: ExpensesProjection | null
  anomalyRule: ExpensesAnomalyRule
```

- [ ] **Passo 4: Ver passar + checagens** — `npx jest && npm run typecheck && npm run lint && npm run build` → verde.

- [ ] **Passo 5: Commit e push** — `git add src && git commit -m "feat(reports): subitens, anomalias e projecao em custos e despesas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin feat/20261013/custos-despesas-b`

---

## Tarefa 2 — MintlyApi: regras puras e cenário

**Files:** Create `src/app/reports/expenses/expenses-detail.ts` (+ `.spec.ts`); Modify `expenses-metrics.ts`, `expenses-metrics.spec.ts`, `expenses-scenario.ts`.

**Interfaces — Consumes:** tipos da T1. **Produces:**

```ts
// expenses-detail.ts
export const ANOMALY_MIN_PCT_ABOVE = 0.5
export const ANOMALY_MIN_EXCESS = 100
export const ANOMALY_MIN_HISTORY_MONTHS = 2
export const ANOMALY_RULE: ExpensesAnomalyRule
export const NO_SUBITEM_KEY = 'none'
export const NO_SUBITEM_NAME = 'Sem subitem'
export function isAnomaly (amountCents: number, averageCents: number | null, eligibleMonths: number): boolean
export function daysInMonth (month: string): number
export function projectionWindow (month: string, today: Date): { elapsedDays: number; daysInMonth: number } | null
export function project (cents: number, w: { elapsedDays: number; daysInMonth: number }): number
export function sortSubitems (list: ExpenseSubitem[]): ExpenseSubitem[]
// expenses-metrics.ts
ExpenseRow += { subcategoryId: string | null; subcategoryName: string | null }
ExpenseCategoryInfo += { subcategories?: { _id: string; name: string }[] }
ExpensesInput += { today: Date }
```

- [ ] **Passo 1: Build local da lib** — `cd ../MintlyLib && npm run build && cd ../MintlyApi && rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build` (não commitar).

- [ ] **Passo 2: Testes de `expenses-detail` que falham** — `expenses-detail.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ExpenseSubitem } from 'mintly-lib'
import { ANOMALY_RULE, daysInMonth, isAnomaly, project, projectionWindow, sortSubitems } from './expenses-detail'

describe('isAnomaly (centavos)', () => {
  it('exatamente +50% (excedente R$ 1.000) com 2 meses → sim', () => expect(isAnomaly(300_000, 200_000, 2)).toBe(true))
  it('excedente exatamente R$ 100 (+100%) → sim', () => expect(isAnomaly(20_000, 10_000, 3)).toBe(true))
  it('+49,9% com excedente R$ 998 → não', () => expect(isAnomaly(299_800, 200_000, 3)).toBe(false))
  it('excedente R$ 99,99 → não, mesmo com +100%', () => expect(isAnomaly(19_998, 9_999, 3)).toBe(false))
  it('só 1 mês elegível → não', () => expect(isAnomaly(100_000, 10_000, 1)).toBe(false))
  it('média 0 ou null → não', () => {
    expect(isAnomaly(100_000, 0, 3)).toBe(false)
    expect(isAnomaly(100_000, null, 3)).toBe(false)
  })
  it('regra exposta', () => expect(ANOMALY_RULE).toEqual({ minPctAbove: 0.5, minExcess: 100, minHistoryMonths: 2 }))
})

describe('projeção', () => {
  it('dias do mês', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-08')).toBe(31)
  })
  it('mês atual → dia de hoje em SP (inclusive)', () => {
    expect(projectionWindow('2026-08', new Date('2026-08-10T15:00:00Z'))).toEqual({ elapsedDays: 10, daysInMonth: 31 })
  })
  it('22h do último dia em SP (já dia 1 em UTC) ainda é o mês', () => {
    expect(projectionWindow('2026-08', new Date('2026-09-01T01:00:00Z'))).toEqual({ elapsedDays: 31, daysInMonth: 31 })
  })
  it('mês fechado → null', () => {
    expect(projectionWindow('2026-08', new Date('2026-09-01T03:30:00Z'))).toBeNull()
    expect(projectionWindow('2026-07', new Date('2026-08-10T15:00:00Z'))).toBeNull()
  })
  it('projeta linear, arredondando ao centavo', () => {
    expect(project(3_230_000, { elapsedDays: 10, daysInMonth: 31 })).toBe(10_013_000)
    expect(project(100, { elapsedDays: 3, daysInMonth: 31 })).toBe(1_033)
    expect(project(500, { elapsedDays: 31, daysInMonth: 31 })).toBe(500)
  })
})

describe('sortSubitems', () => {
  const sub = (key: string, name: string, amount: number): ExpenseSubitem => ({ key, subcategoryId: key === 'none' ? null : key, name, amount, previous: 0, average3: null, deltaPrevious: null, deltaAverage3: null, anomaly: false })
  it('valor desc., nome; "Sem subitem" sempre por último', () => {
    const sorted = sortSubitems([sub('none', 'Sem subitem', 9_000), sub('a', 'Óleo', 100), sub('b', 'Frango', 500), sub('c', 'Embalagens', 100)])
    expect(sorted.map((s) => s.name)).toEqual(['Frango', 'Embalagens', 'Óleo', 'Sem subitem'])
  })
})
```

- [ ] **Passo 3: Ver falhar** — `npx vitest run src/app/reports/expenses/expenses-detail.spec.ts` → FAIL (módulo não existe).

- [ ] **Passo 4: `expenses-detail.ts`**:

```ts
import { ExpenseSubitem, ExpensesAnomalyRule } from 'mintly-lib'
import { toCents } from '../../../core/money/money'
import { toLocalDay } from '../shared/period'

/**
 * Custos & Despesas, fatia B (spec 20261013/custos-despesas-b.md) — regras puras
 * de anomalia, projeção e ordem dos subitens.
 *
 * Limiares de anomalia: palpite do design a partir das prints (Embalagens +66%,
 * Gás +56%), ainda NÃO validado pelo negócio — pendência N4. Ajuste aqui.
 */
export const ANOMALY_MIN_PCT_ABOVE = 0.5
export const ANOMALY_MIN_EXCESS = 100
/** Com 1 mês só de base, uma compra pontual vira alerta falso (decisão B4). */
export const ANOMALY_MIN_HISTORY_MONTHS = 2
export const ANOMALY_RULE: ExpensesAnomalyRule = {
  minPctAbove: ANOMALY_MIN_PCT_ABOVE,
  minExcess: ANOMALY_MIN_EXCESS,
  minHistoryMonths: ANOMALY_MIN_HISTORY_MONTHS,
}

export const NO_SUBITEM_KEY = 'none'
export const NO_SUBITEM_NAME = 'Sem subitem'

/** Valor e média em centavos. Média 0 (gasto novo) não tem com o que comparar. */
export function isAnomaly (amountCents: number, averageCents: number | null, eligibleMonths: number): boolean {
  if (eligibleMonths < ANOMALY_MIN_HISTORY_MONTHS || averageCents == null || averageCents <= 0) return false
  const excess = amountCents - averageCents
  return excess >= toCents(ANOMALY_MIN_EXCESS) && excess / averageCents >= ANOMALY_MIN_PCT_ABOVE
}

/** Dias do mês AAAA-MM (calendário puro). */
export function daysInMonth (month: string): number {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year, m, 0)).getUTCDate()
}

/** Só quando `month` é o mês de hoje em SP; `elapsedDays` conta o dia de hoje. */
export function projectionWindow (month: string, today: Date): { elapsedDays: number; daysInMonth: number } | null {
  const day = toLocalDay(today)
  if (day.slice(0, 7) !== month) return null
  return { elapsedDays: Number(day.slice(8, 10)), daysInMonth: daysInMonth(month) }
}

/** Projeção linear em centavos, arredondada. */
export function project (cents: number, w: { elapsedDays: number; daysInMonth: number }): number {
  return Math.round(cents * w.daysInMonth / w.elapsedDays)
}

/** Valor desc., depois nome; "Sem subitem" sempre por último. */
export function sortSubitems (list: ExpenseSubitem[]): ExpenseSubitem[] {
  const last = (s: ExpenseSubitem) => (s.key === NO_SUBITEM_KEY ? 1 : 0)
  return [...list].sort((a, b) => last(a) - last(b) || b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))
}
```

- [ ] **Passo 5: Ver passar** — mesmo comando → PASS.

- [ ] **Passo 6: Cenário com subcategorias** — em `expenses-scenario.ts`:

1. `Def` ganha `subcategories?: { _id: string; name: string }[]`; a categoria `cmv` ganha
   `subcategories: [{ _id: 'sub-fra', name: 'Frango' }, { _id: 'sub-ole', name: 'Óleo' }, { _id: 'sub-emb', name: 'Embalagens' }]`.
2. `Line` ganha `sub?: 'sub-fra' | 'sub-ole' | 'sub-emb'`. Troque as linhas de CMV (exceto a cancelada) por:

```ts
  { month: 0, key: 'cmv', gross: 6_000, sub: 'sub-fra' },
  { month: 0, key: 'cmv', gross: 1_500, sub: 'sub-ole' },
  { month: 0, key: 'cmv', gross: 2_400, sub: 'sub-emb' },
  { month: 0, key: 'cmv', gross: 2_100 },
  { month: 0, key: 'cmv', gross: 2_000, sub: 'sub-emb', channel: 'delivery' },
  { month: -1, key: 'cmv', gross: 5_500, sub: 'sub-fra' },
  { month: -1, key: 'cmv', gross: 1_500, sub: 'sub-ole' },
  { month: -1, key: 'cmv', gross: 1_500, sub: 'sub-emb' },
  { month: -1, key: 'cmv', gross: 1_500 },
  { month: -2, key: 'cmv', gross: 5_000, sub: 'sub-fra' },
  { month: -2, key: 'cmv', gross: 1_400, sub: 'sub-ole' },
  { month: -2, key: 'cmv', gross: 1_600, sub: 'sub-emb' },
  { month: -2, key: 'cmv', gross: 1_500 },
  { month: -3, key: 'cmv', gross: 5_000, sub: 'sub-fra' },
  { month: -3, key: 'cmv', gross: 1_300, sub: 'sub-ole' },
  { month: -3, key: 'cmv', gross: 1_400, sub: 'sub-emb' },
  { month: -3, key: 'cmv', gross: 1_300 },
```

3. Helper `subName = (id?: string) => CATEGORIES.flatMap((c) => c.subcategories ?? []).find((s) => s._id === id)?.name ?? null`.
4. `expensesScenarioRows`: cada linha ganha `subcategoryId: l.sub ?? null, subcategoryName: subName(l.sub)`.
5. `expensesScenarioCategories`: inclui `subcategories: c.subcategories`.
6. `expensesScenario`: categoria grava `subcategories: (c.subcategories ?? []).map((s) => ({ ...s, status: 'active' }))`;
   movimento grava `...(l.sub ? { subcategory: { _id: l.sub, name: subName(l.sub) } } : {})`.
7. Atualize o comentário do topo: "CMV dividido em Frango/Óleo/Embalagens/Sem subitem (fatia 7)".

- [ ] **Passo 7: Testes de `computeExpenses` que falham** — em `expenses-metrics.spec.ts`:

O helper `scenario` passa `today: new Date('2026-09-15T12:00:00Z')` (mês fechado) antes de `...overrides`. Acrescente:

```ts
describe('computeExpenses — fatia 7: subitens, anomalias, séries, projeção', () => {
  const r = scenario()
  const cmv = byName(r, 'Exp · CMV')

  it('números da fatia 6 não mudam', () => {
    expect(r.total.current).toBe(32_300)
    expect(cmv.amount).toBe(14_000)
  })

  it('subitens do CMV na ordem, com "Sem subitem" por último e soma = categoria', () => {
    expect(cmv.subitems.map((s) => [s.name, s.amount, s.previous, s.average3])).toEqual([
      ['Frango', 6_000, 5_500, 5_166.67],
      ['Embalagens', 4_400, 1_500, 1_500],
      ['Óleo', 1_500, 1_500, 1_400],
      ['Sem subitem', 2_100, 1_500, 1_433.33],
    ])
    expect(cmv.subitems.reduce((a, s) => a + s.amount, 0)).toBe(14_000)
    expect(cmv.subitems.at(-1)).toMatchObject({ key: 'none', subcategoryId: null })
    expect(cmv.subitems[1]).toMatchObject({ key: 'sub-emb', subcategoryId: 'sub-emb', anomaly: true })
  })

  it('categoria sem subcategoria e taxa não têm subitens', () => {
    expect(byName(r, 'Exp · Aluguel').subitems).toEqual([])
    expect(byName(r, 'Taxa iFood').subitems).toEqual([])
  })

  it('anomalias: Embalagens (subitem) e Marketing (categoria inteira), maior excedente primeiro', () => {
    expect(r.anomalies).toHaveLength(2)
    expect(r.anomalies[0]).toMatchObject({ itemKey: 'cmv', categoryId: 'cmv', categoryName: 'Exp · CMV', subcategoryId: 'sub-emb', subitemKey: 'sub-emb', name: 'Embalagens', amount: 4_400, average3: 1_500, excess: 2_900 })
    expect(r.anomalies[0].pctAbove).toBeCloseTo(2_900 / 1_500, 10)
    expect(r.anomalies[1]).toMatchObject({ itemKey: 'mkt', subcategoryId: null, subitemKey: null, name: 'Exp · Marketing', amount: 800, average3: 500, excess: 300, pctAbove: 0.6 })
    expect(r.anomalyRule).toEqual({ minPctAbove: 0.5, minExcess: 100, minHistoryMonths: 2 })
  })

  it('selo: CMV e Marketing; taxa nunca (mesmo +131%)', () => {
    expect(r.items.filter((i) => i.hasAnomaly).map((i) => i.name)).toEqual(['Exp · CMV', 'Exp · Marketing'])
    expect(byName(r, 'Taxa iFood').hasAnomaly).toBe(false)
  })

  it('só 1 mês elegível na média → nenhuma anomalia', () => {
    expect(scenario(null, { firstMonth: addMonths(M, -1) }).anomalies).toEqual([])
  })

  it('subcategoria renomeada: nome atual no subitem e na anomalia', () => {
    const categories = expensesScenarioCategories()
    categories.set('cmv', { ...categories.get('cmv')!, subcategories: [{ _id: 'sub-emb', name: 'Embalagens delivery' }] })
    const rr = scenario(null, { categories })
    expect(byName(rr, 'Exp · CMV').subitems.map((s) => s.name)).toContain('Embalagens delivery')
    expect(byName(rr, 'Exp · CMV').subitems.map((s) => s.name)).toContain('Frango')
    expect(rr.anomalies[0].name).toBe('Embalagens delivery')
  })

  it('séries de 6 meses por item somam o histórico total', () => {
    expect(cmv.history.map((h) => h.amount)).toEqual([0, 0, 9_000, 9_500, 10_000, 14_000])
    const sums = r.history.map((_, i) => Math.round(r.items.reduce((a, it) => a + it.history[i].amount, 0) * 100) / 100)
    expect(sums).toEqual(r.history.map((h) => h.total))
  })

  it('mês fechado: sem projeção', () => {
    expect(r.projection).toBeNull()
    expect(cmv.projected).toBeNull()
  })

  it('mês atual (dia 10 de 31): projeção linear do total e de cada item', () => {
    const rr = scenario(null, { today: new Date('2026-08-10T15:00:00Z') })
    expect(rr.projection).toEqual({ total: 100_130, elapsedDays: 10, daysInMonth: 31 })
    expect(byName(rr, 'Exp · CMV').projected).toBe(43_400)
    expect(rr.total.current).toBe(32_300)
    expect(rr.anomalies).toHaveLength(2)
  })

  it('filtro Delivery: CMV só com Embalagens (média 0), nenhuma anomalia', () => {
    const d = scenario(MovementChannel.Delivery)
    expect(byName(d, 'Exp · CMV').subitems.map((s) => [s.name, s.amount, s.anomaly])).toEqual([['Embalagens', 2_000, false]])
    expect(d.anomalies).toEqual([])
  })

  it('subcategoria só em outro canal: no filtro, a categoria é avaliada inteira', () => {
    const rows: ExpenseRow[] = [-3, -2, -1, 0].flatMap((m) => [
      { month: addMonths(M, m), direction: 'out' as const, categoryId: 'gas', categoryName: 'Gás', accountId: 'c', accountName: 'Caixa', accountType: 'cash', channel: 'delivery', subcategoryId: null, subcategoryName: null, gross: m === 0 ? 900 : 400, fee: 0 },
      { month: addMonths(M, m), direction: 'out' as const, categoryId: 'gas', categoryName: 'Gás', accountId: 'c', accountName: 'Caixa', accountType: 'cash', channel: null, subcategoryId: 's1', subcategoryName: 'Botijão', gross: 100, fee: 0 },
    ])
    const d = scenario(MovementChannel.Delivery, { rows, categories: new Map() })
    expect(d.items[0].subitems).toEqual([])
    expect(d.anomalies).toMatchObject([{ name: 'Gás', subitemKey: null, excess: 500 }])
  })
})
```

- [ ] **Passo 8: Ver falhar** — `npx vitest run src/app/reports/expenses` → FAIL (campos novos ausentes; `today`/`subcategoryId` não existem no tipo).

- [ ] **Passo 9: `expenses-metrics.ts`** — mudanças:

Imports: acrescente `ExpenseAnomaly`, `ExpenseSubitem` de `mintly-lib` e
`import { ANOMALY_RULE, NO_SUBITEM_KEY, NO_SUBITEM_NAME, isAnomaly, project, projectionWindow, sortSubitems } from './expenses-detail'`.
Comentário do topo: "Custos & Despesas, fatias A e B (specs 20261013/custos-despesas.md e custos-despesas-b.md)".

Tipos:

```ts
export interface ExpenseRow {
  // ...campos atuais...
  /** Fatia 7: subcategoria gravada no lançamento (null = sem). */
  subcategoryId: string | null
  subcategoryName: string | null
}

export interface ExpenseCategoryInfo {
  name: string
  behavior: CategoryBehavior
  dreGroup?: DreGroup
  /** Nomes atuais das subcategorias (fatia 7). */
  subcategories?: { _id: string; name: string }[]
}

export interface ExpensesInput {
  // ...campos atuais...
  /** Agora — define se há projeção (mês atual em SP). */
  today: Date
}

interface SubMeta {
  key: string
  subcategoryId: string | null
  name: string
}
```

`MonthBucket` ganha `subs: Map<string, Map<string, number>>` (categoria → subitem → centavos) e
`emptyBucket` inicializa `subs: new Map()`.

Em `bucketize`, declare `const subMetas = new Map<string, Map<string, SubMeta>>()` e
`const withSubcategory = new Set<string>()`; no fim do ramo de saída (depois do `add(b, …)`):

```ts
    // Fatia 7: acumula também por subitem; "Sem subitem" quando o lançamento não tem.
    const subKey = r.subcategoryId ?? NO_SUBITEM_KEY
    if (r.subcategoryId) withSubcategory.add(r.categoryId)
    const metasOfCategory = subMetas.get(r.categoryId) ?? new Map<string, SubMeta>()
    subMetas.set(r.categoryId, metasOfCategory)
    if (!metasOfCategory.has(subKey)) {
      metasOfCategory.set(subKey, {
        key: subKey,
        subcategoryId: r.subcategoryId,
        name: r.subcategoryId
          ? (category?.subcategories?.find((s) => s._id === r.subcategoryId)?.name ?? r.subcategoryName ?? '')
          : NO_SUBITEM_NAME,
      })
    }
    const subsOfCategory = b.subs.get(r.categoryId) ?? new Map<string, number>()
    b.subs.set(r.categoryId, subsOfCategory)
    subsOfCategory.set(subKey, (subsOfCategory.get(subKey) ?? 0) + toCents(r.gross))
```

e retorne `{ buckets, metas, subMetas, withSubcategory }`.

Em `computeExpenses`, troque o laço dos itens por:

```ts
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(M, i - (HISTORY_MONTHS - 1)))
  const window = projectionWindow(M, input.today)
  const measure = (get: (b: MonthBucket) => number) => ({ amount: get(cur), previous: get(prev), avg: average(get) })
  const anomalies: ExpenseAnomaly[] = []
  const anomalyOf = (meta: ItemMeta, sub: SubMeta | null, amount: number, avg: number): ExpenseAnomaly => ({
    itemKey: meta.key,
    categoryId: meta.categoryId,
    categoryName: meta.name,
    subcategoryId: sub?.subcategoryId ?? null,
    subitemKey: sub?.key ?? null,
    name: sub?.name ?? meta.name,
    amount: fromCents(amount),
    average3: fromCents(avg),
    excess: fromCents(amount - avg),
    pctAbove: (amount - avg) / avg,
  })

  const items: ExpenseItem[] = []
  for (const meta of metas.values()) {
    const get = (b: MonthBucket) => b.items.get(meta.key) ?? 0
    const { amount, previous, avg } = measure(get)
    if (amount === 0 && previous === 0 && !avg) continue

    // Fatia 7 (B2): com subitens, avalia cada um; sem, a categoria inteira; taxa nunca.
    let subitems: ExpenseSubitem[] = []
    let hasAnomaly = false
    if (meta.kind === 'category' && withSubcategory.has(meta.key)) {
      for (const sub of subMetas.get(meta.key)!.values()) {
        const s = measure((b) => b.subs.get(meta.key)?.get(sub.key) ?? 0)
        if (s.amount === 0 && s.previous === 0 && !s.avg) continue
        const anomaly = isAnomaly(s.amount, s.avg, eligible.length)
        if (anomaly) {
          hasAnomaly = true
          anomalies.push(anomalyOf(meta, sub, s.amount, s.avg!))
        }
        subitems.push({
          key: sub.key,
          subcategoryId: sub.subcategoryId,
          name: sub.name,
          amount: fromCents(s.amount),
          previous: fromCents(s.previous),
          average3: money(s.avg),
          deltaPrevious: delta(s.amount, s.previous),
          deltaAverage3: delta(s.amount, s.avg),
          anomaly,
        })
      }
      subitems = sortSubitems(subitems)
    } else if (meta.kind === 'category' && isAnomaly(amount, avg, eligible.length)) {
      hasAnomaly = true
      anomalies.push(anomalyOf(meta, null, amount, avg!))
    }

    items.push({
      ...meta,
      amount: fromCents(amount),
      previous: fromCents(previous),
      average3: money(avg),
      deltaPrevious: delta(amount, previous),
      deltaAverage3: delta(amount, avg),
      pctOfRevenue: share(amount, cur.revenue),
      subitems,
      hasAnomaly,
      history: months.map((m) => ({ month: m, amount: fromCents(get(at(m))) })),
      projected: window ? fromCents(project(amount, window)) : null,
    })
  }
  items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))
  anomalies.sort((a, b) => b.excess - a.excess || a.name.localeCompare(b.name, 'pt-BR'))
```

No objeto retornado: `history: months.map((m) => ({ month: m, total: fromCents(total(at(m))) }))` e, no fim:

```ts
    anomalies,
    projection: window ? { total: fromCents(project(totalCur, window)), ...window } : null,
    anomalyRule: ANOMALY_RULE,
```

- [ ] **Passo 10: Ver passar** — `npx vitest run src/app/reports/expenses` → PASS (unitários; o int.spec ainda usa o repositório antigo — se falhar só por `subcategory`, segue na Tarefa 3). `npx tsc --noEmit` → o repositório acusa `subcategoryId` ausente em `ExpenseRow` e a consulta acusa `today`: são da Tarefa 3; registre e siga.

- [ ] **Passo 11: Commit** — `git add src/app/reports/expenses && git commit -m "feat(reports): subitens, anomalias, series e projecao (regras)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 3 — Repositório, consulta e integração

**Files:** Modify `expenses-repository.ts`, `use-cases/expenses.query.ts`, `expenses.int.spec.ts`.

**Interfaces — Consumes:** `ExpenseRow`/`ExpenseCategoryInfo`/`ExpensesInput.today` (T2).

- [ ] **Passo 1: Testes de integração que falham** — em `expenses.int.spec.ts`, acrescente:

```ts
  it('fatia 7: subitens do CMV e anomalias por HTTP', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)

    const r = (await get(auth)).json().payload
    const cmv = r.items.find((i: any) => i.name === 'Exp · CMV')

    expect(cmv.subitems.map((s: any) => [s.name, s.amount])).toEqual([['Frango', 6_000], ['Embalagens', 4_400], ['Óleo', 1_500], ['Sem subitem', 2_100]])
    expect(r.anomalies.map((a: any) => [a.name, a.excess])).toEqual([['Embalagens', 2_900], ['Exp · Marketing', 300]])
    expect(r.items.filter((i: any) => i.hasAnomaly).map((i: any) => i.name)).toEqual(['Exp · CMV', 'Exp · Marketing'])
    expect(r.projection).toBeNull()
  })

  it('subcategoria renomeada mostra o nome atual; lançamento sem o campo vai para "Sem subitem"', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env)
    await plant(env, restaurantId)
    const db = mongoConnection.getDatabase(env)
    await db.collection('financial_categories').updateOne({ restaurantId, name: 'Exp · CMV' }, { $set: { 'subcategories.$[s].name': 'Frango inteiro' } }, { arrayFilters: [{ 's._id': 'sub-fra' }] })
    await db.collection('financial_movements').updateMany({ restaurantId, 'subcategory._id': 'sub-ole' }, { $unset: { subcategory: '' } })

    const cmv = (await get(auth)).json().payload.items.find((i: any) => i.name === 'Exp · CMV')

    expect(cmv.subitems.map((s: any) => [s.name, s.amount])).toEqual([['Frango inteiro', 6_000], ['Embalagens', 4_400], ['Sem subitem', 3_600]])
  })

  it('mês atual: projeção pelo dia de hoje em SP', async () => {
    const { auth, restaurantId } = await signup(freshEnv())
    const now = new Date()
    await mongoConnection.getDatabase(auth.env).collection('financial_movements').insertOne({
      restaurantId, title: 'Hoje', direction: 'out', status: 'settled', statusSource: 'auto', date: now,
      grossValue: toDecimal128(310), feeValue: toDecimal128(0), netValue: toDecimal128(310),
      account: { _id: 'a', name: 'Caixa', type: 'cash' }, category: { _id: 'c', name: 'Gás', type: 'expense' },
      paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: now, updatedAt: now },
    })

    const r = (await get(auth, '')).json().payload
    const day = toLocalDay(now)
    const elapsed = Number(day.slice(8, 10))
    const days = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate()

    expect(r.projection).toEqual({ total: Math.round(31_000 * days / elapsed) / 100, elapsedDays: elapsed, daysInMonth: days })
    expect(r.items[0].projected).toBe(r.projection.total)
  })
```

(acrescente `toLocalDay` ao import de `../shared/period`).

- [ ] **Passo 2: Ver falhar** — `npx vitest run src/app/reports/expenses/expenses.int.spec.ts` → FAIL (sem subitens: o repositório ainda não agrupa por subcategoria; `today` ausente).

- [ ] **Passo 3: Repositório** — em `monthlyRows`, no `_id` do `$group`:

```ts
            // Fatia 7. $ifNull junta ausente e null no mesmo grupo (lançamento antigo sem o campo).
            subcategoryId: { $ifNull: ['$subcategory._id', null] },
```

e nos acumuladores `subcategoryName: { $first: '$subcategory.name' }`. No `map`:

```ts
      subcategoryId: r._id.subcategoryId ?? null,
      subcategoryName: r.subcategoryName ?? null,
```

Em `categories()`: projeção `{ name: 1, dreGroup: 1, behavior: 1, subcategories: 1 }` e o valor
`{ name: d.name, behavior: d.behavior, dreGroup: d.dreGroup, subcategories: (d.subcategories ?? []).map((s: any) => ({ _id: s._id, name: s.name })) }`.

- [ ] **Passo 4: Consulta** — em `expenses.query.ts`, guarde `const now = this.clock()`, use-o em
`parseReferenceMonth(month, now)` e passe `today: now` ao `computeExpenses`.

- [ ] **Passo 5: Ver passar** — `npx vitest run src/app/reports/expenses` → PASS.

- [ ] **Passo 6: Suíte inteira** — `npm run lint && npm run typecheck && npm run test:ci` → verde, ≥ 90%.

- [ ] **Passo 7: Commit** — `git add src/app/reports/expenses && git commit -m "feat(reports): subitens e anomalias em GET /reports/expenses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 4 — E2E e Insomnia

- [ ] **Passo 1: E2E** — em `tests/e2e/expenses.e2e.spec.ts`, acrescente:

```ts
  it('subcategoria criada e usada aparece como subitem do CMV', async () => {
    const sub = await fetch(`${baseUrl}/financial-categories/${cmvCatId}/subcategories`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Frango' }) })
    expect(sub.status).toBe(201)
    const subId = (await sub.json() as any).payload._id
    const created = await fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ direction: 'out', title: 'Frango E2E', grossValue: 120, date: new Date().toISOString(), accountId: cashId, categoryId: cmvCatId, subcategoryId: subId, paymentMethod: 'pix' }) })
    expect(created.status).toBe(201)

    const r = (await (await fetch(`${baseUrl}/reports/expenses`, { headers: auth })).json() as any).payload
    const cmv = r.items.find((i: any) => i.categoryId === cmvCatId)

    expect(cmv.subitems.map((s: any) => [s.name, s.amount])).toEqual([['Frango', 120], ['Sem subitem', 300]])
    expect(r.projection).not.toBeNull()
  })
```

(o teste anterior do arquivo já lançou CMV 300 sem subcategoria no mesmo restaurante.) `npm run test:e2e` → verde.

- [ ] **Passo 2: Insomnia** — na requisição `req_expenses`, descrição: "Fatias 6 e 7. ?month=AAAA-MM (padrão: mês corrente) e ?channel=dineIn|delivery (sem = Geral). Traz subitens por categoria, anomalias do mês (Fique de olho), séries de 6 meses e projeção do mês atual."

- [ ] **Passo 3: Commit** — `git add tests/e2e/expenses.e2e.spec.ts insomnia/MintlyApi.insomnia_v4.json && git commit -m "test(reports): E2E de subitens em custos e despesas e insomnia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Tarefa 5 — Fechar a fatia

- [ ] PR da lib (`feat(reports): custos e despesas, fatia B`) → merge → `npm i mintly-lib@<versão>` na API → suíte → commit `chore(deps)`.
- [ ] `andamento.md` (fatia 7 em review; pendências; Jira; N4 continua aberto) → commit `docs(modulos-novos): andamento da fatia 7`.
- [ ] PR da API (`feat(reports): custos e despesas, fatia B`) com contrato, regras, "nenhum comando novo"; `gh pr checks` verde.

---

## Self-review

- **Cobertura da spec:** contrato (+ comentário do `pctOfDelivery`) → T1; tabela de regras inteira (subitens existem, "Sem subitem", nome atual × gravado, valores, listagem/ordem/soma, unidade avaliada, anomalia, `hasAnomaly`, `anomalies`, `history` por item, projeção, canal) → T2; repositório (`$ifNull`, nomes das subcategorias), relógio, HTTP → T3; E2E e Insomnia → T4.
- **Placeholders:** nenhum.
- **Tipos:** `ExpenseRow.subcategoryId/subcategoryName`, `ExpenseCategoryInfo.subcategories`, `ExpensesInput.today` (T2) usados em T3; `ExpenseSubitem`/`ExpenseAnomaly`/`ExpensesAnomalyRule` (T1) em T2.
- **Conferência do cenário:** médias em centavos — Frango 1.550.000/3 = 516.666,67 → 516.667 → 5.166,67; Sem subitem 430.000/3 → 143.333 → 1.433,33; Embalagens (150.000 + 160.000 + 140.000)/3 = 150.000; Marketing (100.000 + 0 + 50.000)/3 = 50.000. Óleo: excedente exatamente R$ 100 mas 100/1.400 = 7,1% → não dispara. Sem subitem: 66.667/143.333 = 46,5% → não. Projeção: 3.230.000 × 31 / 10 = 10.013.000 centavos.
- **Review Focus:** os cinco têm teste — média zero (T2 `isAnomaly` e Motoboy no cenário), 22h do último dia (T2), subcategoria só em outro canal (T2), renomeada (T2 e T3), lançamento sem o campo (T3).
