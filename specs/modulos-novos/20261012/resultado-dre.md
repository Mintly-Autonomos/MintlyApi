# Fatia 4 — Resultado (DRE)

`GET /reports/result?month=AAAA-MM` · consome o `dreGroup` (M2) e o perfil tributário (M5, MIN-23) da fatia 3

Roteiro geral: `specs/modulos-novos/20260929/design.md` (1.x e 3.2). Este documento detalha a fatia e
corrige o design onde as perguntas de 12/10/2026 decidiram diferente.

---

## Contexto

O Resultado responde "quanto sobrou no fim das contas": o DRE simplificado do mês, por competência
(D7). As fatias anteriores entregaram o que ele precisa: a classificação contábil da despesa
(`dreGroup`, `behavior` com `mixed`) e o imposto do mês (`buildTaxProfile`, `TaxProfileQuery`).

Fontes:

- **Prints** — `Mintly/prints modulos novos/`, capturas `095812` a `095939` (7 telas): lucro do mês com
  margem e variação, ponto de equilíbrio (valor, dia, margem de contribuição, custos fixos), cards de
  receita bruta / margem bruta / despesas operacionais / margem líquida, "Leitura do mês" (2 blocos),
  cascata, DRE linha a linha (R$ e % da receita), composição das despesas operacionais e histórico
  de 6 meses (lucro e margem).
- **`Backend Pendente.html`**, item 04 — ajustado pela D6 (número cru).
- Não há história no Jira para esta fatia (design, Parte 5: "criadas quando entrarem na fila").

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| R1 | Taxa de plataforma (Σ `feeValue` das entradas) entra em **despesas operacionais** como item sintético variável | É o que as prints mostram: R$ 27.500 = pró-labore 8.000 + taxa iFood 6.044 + aluguel 6.000 + … |
| R2 | "Leitura do mês" como insights determinísticos `profitChanged` e `largestOpexItem` | Os dois blocos saem de cálculo; texto é do front (D6); projeção é de Previsões (bloqueado) |
| R3 | No ponto de equilíbrio, **misto conta como fixo** (fecha a N8) | Leitura conservadora: ponto de equilíbrio mais alto |
| R4 | Agregação por mês × categoria no Mongo + regra pura em TS | O DRE só precisa de somas; regra testável sem banco |
| R5 | Classificação lida da **categoria atual**, não do snapshot da movimentação | Corrigir a classificação vale para o histórico (T7 da fatia 3) |
| R6 | `?month=AAAA-MM` opcional (padrão: mês corrente) | A tela mostra "Julho/2026"; mesmo contrato do `/restaurants/me` |

**Correção do design (3.2):** o design punha a taxa de plataforma numa linha própria antes da margem
bruta (`margemBruta = receitaLiquida − cmv − taxaPlataforma`). Pelas prints (R1), a margem bruta é
`receitaLiquida − cmv` e a taxa está em despesas operacionais.

**Alternativas recusadas:** taxa de plataforma como linha própria (diverge da tela); insights vazios
até a fase de IA (buraco na tela); texto pronto no backend (contraria D6); buscar todas as linhas e
somar em TS (lê milhares de documentos para somar); `$lookup` das categorias no pipeline (regra
contábil só testável em integração); misto como variável ou 50/50 (otimista ou inventado).

---

## Contrato

```
GET /reports/result?month=AAAA-MM
```

- `month` opcional; formato inválido ou futuro → 400 (`parseReferenceMonth`).
- Autenticado; restaurante do `RequestContext`. Envelope `{ payload: ResultReport }`.

```ts
interface ResultLines {
  grossRevenue: number          // Σ grossValue das entradas
  taxes: number                 // Simples: alíquota efetiva × receita bruta; MEI: DAS do mês; sem regime: 0
  netRevenue: number            // grossRevenue − taxes
  cmv: number                   // Σ saídas com dreGroup 'cmv'
  grossMargin: number           // netRevenue − cmv
  operatingExpenses: number     // labor + opex (+ sem grupo) + taxa de plataforma
  netProfit: number             // grossMargin − operatingExpenses
  netMargin: number | null      // netProfit / grossRevenue; null sem receita
}

interface OpexItem {
  categoryId: string | null     // null no item sintético
  name: string
  kind: 'labor' | 'opex' | 'platformFee'
  behavior: 'fixed' | 'variable' | 'mixed'
  amount: number
  previousAmount: number
  delta: number | null          // (atual − anterior) / |anterior|; null se anterior 0
  revenuePct: number | null     // amount / grossRevenue
}

type ResultInsight =
  | { kind: 'profitChanged'; severity: 'positive' | 'warning'; difference: number;
      previousProfit: number; currentProfit: number; previousMargin: number | null; currentMargin: number | null }
  | { kind: 'largestOpexItem'; severity: 'warning'; name: string; amount: number; revenuePct: number | null }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

interface ResultReport {
  referenceMonth: string
  previousMonth: string
  current: ResultLines
  previous: ResultLines
  deltas: Record<'grossRevenue' | 'taxes' | 'netRevenue' | 'cmv' | 'grossMargin' | 'operatingExpenses' | 'netProfit', number | null>
  tax: { regime: TaxRegime | null; effectiveRate: number | null; meiMonthlyDas: number | null }
  operatingExpenseItems: OpexItem[]
  breakEven: {
    fixedCosts: number
    variableCosts: number
    contributionMarginPct: number | null
    breakEvenRevenue: number | null   // receita BRUTA que paga os custos fixos
    reachedOnDay: number | null
  }
  history: Array<{ month: string; grossRevenue: number; netProfit: number; netMargin: number | null }>   // M−5 … M
  insights: ResultInsight[]
}
```

**Fora do contrato do `Backend Pendente.html`** (D6): `refLabel`, `linhasDRE` com labels e explicações,
`waterfallResultado`, `lucroSpark`, `pctReceita` — o front deriva de `current`, `previous` e `history`.

---

## Regra

Pura, em `src/app/reports/result/result-metrics.ts`. Somas em centavos. Competência (`date`), meses em
America/Sao_Paulo, canceladas fora.

### Linhas de um mês m

| Linha | Regra |
|---|---|
| `grossRevenue` | Σ `grossValue` das entradas de m |
| `taxes` | Simples: `round(grossRevenue × effectiveRate(m))`, com `effectiveRate(m)` do `buildTaxProfile`. MEI: DAS vigente em m, **só a partir do mês da primeira movimentação**; DAS não semeado → 0. Sem regime → 0 |
| `cmv` | Σ saídas cuja categoria atual tem `dreGroup: 'cmv'` |
| despesas operacionais | Σ saídas com `dreGroup` `labor`, `opex` ou **ausente** + taxa de plataforma (Σ `feeValue` das entradas de m) |
| fora de tudo | saídas com `dreGroup: 'tax'` (o imposto do DRE vem da alíquota; o pagamento aparece só no Fluxo de Caixa) |

Saída cuja categoria não existe mais no restaurante → `opex`, com o nome guardado no lançamento.
O regime atual vale para os 6 meses do histórico (não há histórico de regime — limitação registrada).

### Variações

`delta = (atual − anterior) / |anterior|`; anterior 0 → `null`. O módulo faz um prejuízo menor
aparecer como melhora.

### Composição

Uma entrada por categoria `labor`/`opex`/sem grupo com valor em M **ou** M−1, mais o item sintético
`{ categoryId: null, name: 'Taxa de plataforma', kind: 'platformFee', behavior: 'variable' }` se houver
taxa em M ou M−1. `kind` da categoria: `labor` se `dreGroup: 'labor'`, senão `opex`. Ordenação:
`amount` decrescente, empate por nome (`pt-BR`).

### Ponto de equilíbrio (mês M)

```
fixedCosts            = Σ despesas cmv/labor/opex com behavior 'fixed' ou 'mixed'      (R3)
variableCosts         = Σ despesas cmv/labor/opex com behavior 'variable' + taxa de plataforma
contributionMarginPct = (netRevenue − variableCosts) / netRevenue          (null se netRevenue ≤ 0)
breakEvenRevenue      = fixedCosts × grossRevenue / (netRevenue − variableCosts)   (null se pct null ou ≤ 0)
reachedOnDay          = primeiro dia d de M com Σ receita bruta até d ≥ breakEvenRevenue
                        (null se breakEvenRevenue null ou não alcançado)
```

`breakEvenRevenue` é **receita bruta** — a que o dono compara com o que vende. *Corrigido na revisão
final: a versão aprovada dividia pela margem sobre a receita líquida (`fixedCosts /
contributionMarginPct`), o que dava um valor em receita líquida, mostrado ao lado da bruta.*

`MIXED_BEHAVIOR_AS = 'fixed'` como constante nomeada. A conferência pela print (15.200 ÷ 49,9%) não é
reproduzível — os números da tela são de exemplo e não fecham entre si; a fórmula é conferida pelo
cenário (`result-scenario.ts`: equilíbrio de R$ 42.912,87 de receita bruta, atingido no dia 20).

### Insights

| Insight | Quando |
|---|---|
| `profitChanged` | M−1 teve movimento (receita ou despesa) e `netProfit` mudou; `positive` se subiu, `warning` se caiu |
| `largestOpexItem` | o primeiro item da composição com `amount > 0` (inclui a taxa de plataforma) |
| `taxRegimeNotConfigured` | restaurante sem regime |

---

## Consultas

`src/app/reports/result/result-repository.ts`, todas com `restaurantId` do contexto:

1. `monthlyTotals(ctx, { from, to })` — agregação por `{ mês ($dateToString com timezone), direção,
   category._id }`: Σ `grossValue`, Σ `feeValue`, nome da categoria do lançamento. Índice
   `{ restaurantId, date }` existente.
2. `categories(ctx)` — todas as categorias do restaurante (ativas e inativas): `_id`, `name`, `type`,
   `dreGroup`, `behavior`.
3. `dailyRevenue(ctx, month)` — receita bruta por dia de M.

Imposto: `TaxRepository.revenueByMonth(M−18 … M)` e `firstMovementMonth()`;
`TaxSettingsRepository.meiMonthlyDasAt(m)` só no MEI; regime pelo `RestaurantRepository.findMine`.

`parseReferenceMonth` sai de `src/app/restaurant/` para `src/app/reports/shared/period.ts` (dois
consumidores agora).

---

## Estrutura

**MintlyLib:** `src/core/data/reports/result-response.ts` (tipos acima) e
`ReportClient.result(query, headers)`.

**MintlyApi:**

```
src/app/reports/result/
├── result-routes.ts            # GET /reports/result (plugin próprio sob /reports)
├── result-controller.ts
├── result-repository.ts
├── result-metrics.ts
├── result-scenario.ts          # cenário de conferência
└── use-cases/result.query.ts
scripts/app/seed-demo.ts        # SEED_SCENARIO=result
insomnia/MintlyApi.insomnia_v4.json
```

Sem mudança de schema, sem índice novo, sem comando novo no ambiente.

---

## Testes

**Unitário** — linhas (Simples, MEI, MEI antes da primeira movimentação, sem regime, saída `tax` fora,
sem grupo como opex, taxa de plataforma, margem `null`); variações (módulo, anterior 0); composição
(categoria só em M−1, sintético, ordenação); ponto de equilíbrio (caso da print, misto como fixo,
margem ≤ 0, `reachedOnDay` com dia/`null`/dia 1); insights; histórico de 6 meses com meses vazios.

**Integração** — cenário plantado confere linha a linha, com alíquota de 6% como na print; trocar o
`dreGroup` de uma categoria muda o DRE do mês passado; receita às 22h do último dia no mês certo;
isolamento de dois restaurantes; `month` inválido/futuro → 400; sem token → 401.

**E2E** — receita + despesa `cmv` por HTTP real; receita, CMV e lucro conferidos.

**Conferência** — `SEED_SCENARIO=result npm run db:seed-demo` com os esperados no script; Insomnia.

Threshold de 90% nas quatro métricas.

---

## Entrega

1. **MintlyLib** `feat/20261012/resultado-dre` a partir de `staging` — aditivo, `feat` sem `!`.
2. **MintlyApi** `feat/20261012/resultado-dre` a partir de `staging`.

Nenhum comando novo no ambiente (o DRE depende do backfill do `dreGroup` da fatia 3, já listado).

---

## Fora de escopo

- Projeção ("o próximo mês fecha acima de …") — Previsões, bloqueado.
- Lucro por canal (Salão × Delivery) — depende do `channel` (fatia 5) e do rateio (N3).
- Histórico de regime tributário.
- Textos narrativos — fase de IA.

---

## Self-review

- **Placeholders:** nenhum.
- **Consistência:** a correção do design (taxa de plataforma) está declarada e bate com R1, com a
  tabela de linhas e com a composição; N8 fecha por R3.
- **Ambiguidade:** "despesa sem grupo" é sempre opex; "mês" é civil em São Paulo; `reachedOnDay`
  compara receita líquida acumulada proporcional, definida por fórmula.
- **Escopo:** um endpoint, uma regra pura, três consultas — cabe num plano.
