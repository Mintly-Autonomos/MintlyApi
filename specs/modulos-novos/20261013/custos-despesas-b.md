# Fatia 7 — Custos & Despesas, fatia B (subitens, anomalias, evolução)

Subitens da categoria · "Fique de olho" e selo "alerta" · evolução por categoria com projeção do mês

Roteiro geral: `specs/modulos-novos/20260929/design.md` (3.3, M4). Base: fatia 6
(`specs/modulos-novos/20261013/custos-despesas.md`). Este documento detalha a fatia.

---

## Contexto

A tela de Custos & Despesas (prints `095645` a `095758`) completa o que a fatia 6 entregou:

- abrir uma categoria mostra os subitens (CMV/Insumos → Frango, Óleo, Embalagens…) com o mês, o
  anterior e a média;
- "Fique de olho" lista gastos que fugiram do padrão ("Embalagens acima do normal: você gastou cerca
  de R$ 900,00 a mais… (+60%)… em CMV / Insumos"), e a categoria ganha o selo "alerta";
- "Evolução das despesas" mostra 6 meses, total ou por categoria, com o trecho do mês atual
  pontilhado como projeção.

Subcategoria e canal vieram na fatia 5; a janela de 6 meses, o canal efetivo e a média de 3 meses,
na fatia 6.

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| B1 | Tudo no próprio `GET /reports/expenses` (campos novos) | Mesma consulta e mesma janela; uma chamada só; aditivo |
| B2 | Anomalia por **subitem** (inclusive "Sem subitem"); categoria sem subitens é avaliada **inteira**; taxa de plataforma fora | Subcategoria é opcional e gradual — sem isso o "Fique de olho" fica vazio por meses; a taxa segue a venda, não é gasto controlável |
| B3 | Projeção **linear** do mês atual (`até hoje × dias do mês / dias decorridos`), em campo separado; só no mês atual | Simples de explicar; o real do mês nunca é alterado |
| B4 | Anomalia exige **≥ 2 meses** elegíveis na média | Com 1 mês, uma compra pontual vira alerta falso |
| B5 | Anomalia avaliada **só no mês consultado** (Fique de olho, selo e ponto do gráfico); compara o **real**, nunca o projetado | Janela segue de 6 meses; uma regra só; sem alarme no começo do mês |

Limiares (N4, palpite não validado): **≥ 50%** acima da média **e** excedente **≥ R$ 100** —
constantes nomeadas, comentadas com a referência ao N4.

**Alternativas recusadas:** rotas separadas para subitens/evolução; anomalia só em subcategoria
real; os dois níveis sempre (alerta duplicado); projeção só das variáveis; sem projeção; média de 1
mês ou de 3 completos; saltos em todos os meses do gráfico (janela de 9 meses).

---

## Contrato (MintlyLib) — aditivo

```ts
interface ExpenseSubitem {
  key: string                    // subcategoryId | 'none'
  subcategoryId: string | null   // null = "Sem subitem"
  name: string                   // nome atual da subcategoria (mesmo inativa); "Sem subitem"
  amount: number
  previous: number
  average3: number | null
  deltaPrevious: number | null
  deltaAverage3: number | null
  anomaly: boolean
}

// ExpenseItem ganha:
subitems: ExpenseSubitem[]       // [] se a categoria não tem lançamento com subcategoria na janela; taxa → []
hasAnomaly: boolean              // selo "alerta": a categoria ou algum subitem dela
history: { month: string; amount: number }[]   // 6 meses, mais antigo primeiro
projected: number | null         // projeção do mês atual; null em mês fechado

interface ExpenseAnomaly {
  itemKey: string                // ExpenseItem.key da categoria
  categoryId: string | null
  categoryName: string
  subcategoryId: string | null
  subitemKey: string | null      // ExpenseSubitem.key; null = avaliação da categoria inteira
  name: string                   // nome do subitem ou da categoria
  amount: number
  average3: number
  excess: number                 // amount − average3
  pctAbove: number               // excess / average3
}

// ExpensesReport ganha:
anomalies: ExpenseAnomaly[]      // maior excedente primeiro; empate por nome
projection: { total: number; elapsedDays: number; daysInMonth: number } | null
anomalyRule: { minPctAbove: number; minExcess: number; minHistoryMonths: number }   // 0.5 / 100 / 2
```

Junto, o comentário de `ExpensesPlatformFee.pctOfDelivery` passa a dizer que o denominador é o bruto
das contas de plataforma (decisão A da fatia 6).

O texto dos cards ("Você gastou cerca de R$ 900,00 a mais…") é do front, com `excess`, `pctAbove`,
`name` e `categoryName`.

---

## Regras

Puras em `src/app/reports/expenses/expenses-detail.ts`; somas em centavos.

| Regra | Definição |
|---|---|
| Subitens existem | Categoria tem ≥ 1 lançamento com subcategoria na janela de 6 meses (no canal filtrado) |
| "Sem subitem" | Lançamentos da categoria sem subcategoria, `key: 'none'`; aparece se tiver valor (mês, anterior ou média) |
| Nome do subitem | Nome atual em `category.subcategories`; sem ela, o nome gravado no lançamento |
| Valores do subitem | Mesmas regras da fatia 6 (média desde o primeiro lançamento; base 0 → variação `null`) |
| Subitens listados | Com valor no mês, no anterior ou na média; ordem: valor desc., nome; "Sem subitem" sempre por último. Σ subitens = valor da categoria |
| Unidade avaliada | Com subitens: cada subitem (inclusive "Sem subitem"). Sem subitens: a categoria inteira. Taxa de plataforma: nunca |
| Anomalia | ≥ 2 meses elegíveis entre M−1..M−3 — contados desde o primeiro lançamento do restaurante **e** desde o primeiro mês com gasto **daquela unidade** na janela (decisão A da revisão: adoção gradual de subcategoria não gera alerta falso); média própria da unidade nesses meses, que é a `average3` da anomalia — **e** média > 0 **e** `valor − média ≥ R$ 100` **e** `(valor − média) / média ≥ 0,5`. Valor = real do mês consultado |
| `hasAnomaly` | A categoria inteira ou algum subitem dela é anômalo |
| `anomalies` | Todas as unidades anômalas; ordem: `excess` desc., depois `name` |
| `history` do item | 6 meses (mesma janela e canal). Σ itens = `history` total nos meses M−3..M; em M−4/M−5 pode faltar a categoria que só teve gasto lá (ela não entra na lista — regra de listagem da fatia 6) |
| Projeção | Só se mês consultado = mês atual (SP). `elapsedDays` = dia de hoje em SP (inclusive); `daysInMonth` = dias do mês. `total` = `round(gasto até hoje × daysInMonth / elapsedDays) + lançado para depois de hoje no mês` em centavos (o agendado — aluguel do dia 25 — entra pelo valor cheio, sem multiplicar; ajuste da revisão); por item, a mesma conta em `projected`. Mês fechado → `projection: null`, `projected: null` |
| Canal | Tudo acima parte das linhas já filtradas pelo canal efetivo |

---

## API

- `expenses-repository.ts`: `monthlyRows` agrupa também por `subcategory._id`, com `$first` do nome;
  `categories()` projeta `subcategories`.
- `expenses-detail.ts` (novo): `buildSubitems`, `evaluateAnomalies`, `itemHistory`, `projectionWindow`.
- `expenses-metrics.ts`: `ExpenseRow` ganha `subcategoryId`/`subcategoryName`; `ExpenseCategoryInfo`
  ganha `subcategories?`; `ExpensesInput` ganha `today: Date`; `computeExpenses` monta os campos novos.
- `use-cases/expenses.query.ts`: passa `today: this.clock()`.

Sem índice novo, sem comando no ambiente, sem erro novo.

---

## Testes

**Unitário** — subitens ("Sem subitem", nome atual × gravado, Σ = categoria, ordem, só "Sem subitem"
→ sem subitens); anomalia nos limites (50% exato, R$ 100 exato, 49,9%, R$ 99,99, 1 mês elegível,
média 0, taxa de plataforma, categoria sem subitens inteira); `hasAnomaly`; ordem de `anomalies`;
`history` por item somando o total; projeção (dia 10 do mês atual, mês fechado, último dia, 22h do
último dia em SP); filtro de canal nos subitens. Os números da fatia 6 seguem iguais.

**Integração** — cenário por HTTP com subitens e anomalia; projeção com relógio fixo; subcategoria
renomeada mostra o nome atual.

**E2E** — criar subcategoria, lançar com ela, ler os subitens.

**Insomnia** — descrição de "Custos & Despesas" atualizada.

Threshold de 90% nas quatro métricas.

---

## Entrega

1. **MintlyLib** `feat/20261013/custos-despesas-b` a partir de `staging` — `feat` sem `!`.
2. **MintlyApi** `feat/20261013/custos-despesas-b` a partir de `staging`.

Nenhum comando novo no ambiente.

---

## Fora de escopo

- Saltos atípicos nos meses passados do gráfico.
- Validação dos limiares com o negócio (N4 segue aberto).
- Projeção que separa fixo de variável.
- Notificação de anomalia.

---

## Self-review

- **Placeholders:** nenhum.
- **Consistência:** B2 (taxa fora) não afeta `hasAnomaly` de taxa (sempre `false`); B5 (só o mês
  consultado) e o `history` (6 meses sem marcação) não se contradizem — o front destaca o ponto do mês
  consultado quando `hasAnomaly`.
- **Ambiguidade:** "categoria tem subitens" é definido pela janela e pelo canal; anomalia usa a média
  arredondada ao centavo, a mesma que a resposta mostra.
- **Escopo:** campos novos num relatório existente e um arquivo de regras — cabe num plano.
