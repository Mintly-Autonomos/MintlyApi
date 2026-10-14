# Ajustes das telas (pós-teste com dados) — itens 1 a 5

Origem: revisão das prints × API e teste local com um restaurante semeado (743 lançamentos) e um
restaurante novo, em 13/10/2026. Decisões aprovadas pelo dono ("pode corrigir os itens de 1 a 5 usando
sua recomendação"). Specs base: fatias 4, 6, 7 e 8 (`20261012/resultado-dre.md`,
`20261013/custos-despesas.md`, `custos-despesas-b.md`, `visao-geral.md`) e Fluxo (`20261012/fluxo-de-caixa.md`).

---

## Problemas encontrados

| # | Problema | Evidência (13/10) |
|---|---|---|
| 1 | "vs. mês anterior" e "vs. média 3 meses" comparam o mês atual pela metade com meses cheios | Visão Geral: lucro −233%, receita −51%; Custos: Marketing/Impostos −100%; DRE: "seu lucro caiu R$ 18.341" |
| 2 | Projeção de despesa multiplica custo fixo já pago | Aluguel 6.000 → 14.307; total projetado 108.820 contra 60–66 mil/mês |
| 3 | No mês atual o score usa o mês fechado, mas os insights de CMV/prime cost usam o mês pela metade | Score 88 "saudável" ao lado de "CMV 50%, prime 89%" |
| 4 | Restaurante novo recebe score com 1 pilar só | 10 dias de uso → só fôlego → 13 "risco" |
| 5 | "Próximos vencimentos" inundado de pedidos de plataforma | 51 de 56 itens eram pedidos individuais iFood/Rappi |

---

## Regras

### A1 — Comparação do mês atual pelo mesmo período (item 1)

Quando o mês consultado é o **mês atual** (SP), as bases de comparação usam **os mesmos dias**: do
dia 1 ao dia de hoje (`untilDay` = dia de hoje em SP; meses mais curtos param no último dia deles).

- **Resultado (DRE):** `previous` (linhas do mês anterior) e `deltas` usam o mês anterior até `untilDay`;
  `insights` (`profitChanged`) idem. `current` e `history` não mudam.
- **Custos:** `previous` e `average3` (itens, subitens, total, taxa de plataforma, receita) usam
  M−1..M−3 até `untilDay`; variações idem. A anomalia do mês atual compara com essa média do mesmo
  período. `amount`, `history` e a projeção não mudam.
- **Visão Geral:** `delta` de lucro/receita e `previousPct`/`deltaPoints` de CMV/prime vêm dos
  relatórios acima (portanto do mesmo período).
- Mês fechado: tudo como antes (mês cheio).
- **Contrato (aditivo):** `comparison: { kind: 'samePeriod' | 'fullMonth'; untilDay: number | null }`
  em `ResultReport`, `ExpensesReport` e `OverviewReport` — o front escreve "vs. 1–13 de set".
- **Implementação:** os agrupamentos mensais ganham `grossUntil`/`feeUntil` (soma dos lançamentos com
  dia do mês em SP ≤ `untilDay`), calculados só quando há corte.

### A2 — Projeção de despesa por comportamento (item 2)

Por item, no mês atual:

- `variable` (e taxa de plataforma): como hoje — `round(até hoje × dias do mês / dias decorridos) + lançado depois de hoje`.
- `fixed` e `mixed`: `max(valor do mês, média dos meses cheios elegíveis de M−1..M−3)`; sem mês
  elegível → o valor do mês (sem multiplicar).
- `projection.total` = Σ `projected` dos itens. `projection.revenue` não muda (linear + agendado).

### A3 — Insights de CMV e prime cost na mesma base do score (item 3)

Na Visão Geral do **mês atual**, `cmvAboveTarget` e `primeCostAboveTarget` avaliam o **mês-base do
score** (último mês fechado, cheio): % = Σ do grupo no mês-base ÷ receita do mês-base; `impact` com a
receita do mês-base. Os dois insights ganham `basisMonth`. Os cards de CMV/prime continuam mostrando
o mês atual (até agora). Mês passado: como antes (`basisMonth` = o próprio mês).

### A4 — Score exige pelo menos 2 pilares (item 4)

Com menos de **2** pilares com dado, `score: null` e `label: 'noData'` (os pilares seguem na
resposta com as notas que tiverem). Constante `MIN_PILLARS = 2` (palpite N5).

### A5 — Repasses de plataforma agrupados em "Próximos vencimentos" (item 5)

Entradas em conta `platform` viram **um item por conta × data de repasse** (`dueDate`, ou `settledAt`
quando já liquidadas na janela realizada), com `kind: 'platformPayout'`, título `Repasse <conta>`,
`amount` = Σ líquido (o que de fato entra), `itemCount` = quantos pedidos, `status` pending se algum
pendente, `overdue` se pendente e vencido. Id `payout:<accountId>:<data>:<status>`. Categoria:
`{ _id: '', name: 'Repasse de plataforma' }`. Demais lançamentos: `kind: 'movement'`, `itemCount: 1`.
Contrato: `DueItem.kind?` e `DueItem.itemCount?` (opcionais, aditivos). Totais, projeção e insights do
Fluxo não mudam.

---

## Testes

Unitários por regra (limites: dia 1, dia 31 com mês anterior de 30 dias, fevereiro, mês fechado);
integração por HTTP com relógio fixo; regressão dos números das fatias 4, 6, 7, 8 para meses
fechados. Depois, bateria local com muitos dados, todos os filtros e parâmetros, e um "oráculo" que
recalcula os totais direto dos lançamentos.

## Entrega

Lib e API em `feat/20261014/ajustes-telas`; `feat` sem `!`. Nenhum comando novo no ambiente.
