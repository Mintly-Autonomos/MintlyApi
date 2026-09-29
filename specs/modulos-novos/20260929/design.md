# Módulos novos — design geral

Visão Geral · Fluxo de Caixa · Receitas · Custos & Despesas · Resultado · Previsões

---

## Contexto

O MintlyApi hoje entrega três módulos de escrita — movimentações, contas financeiras e
categorias. As telas novas do produto pedem seis módulos de **leitura**: Visão Geral, Fluxo de
Caixa, Receitas, Custos & Despesas, Resultado (DRE) e Previsões.

Duas fontes definem o escopo:

- **Prints das telas** (`Mintly/prints modulos novos/`, 35 imagens). São **referência de
  entendimento** — que gráfico existe, o que cada número significa, como as telas se ligam.
  O front **não** é escopo deste trabalho; nenhuma linha de MintlyWeb será escrita aqui.
- **`Mintly/Backend Pendente.html`** — 14 contratos de endpoint mapeados a partir dos services
  do MintlyWeb, cobrindo os seis módulos mais import em massa, notificações e avatar de perfil.

O que a leitura das duas fontes mostrou: **cinco dos seis módulos são agregação pura** sobre
`financial_movements`, sem escrita. Previsões é a exceção (tem simulação, que é cálculo sem
persistência). E três conceitos que as telas usam **não existem no modelo de dados**: vencimento
de saída, corte contábil das despesas (CMV × pró-labore × imposto × demais) e o domínio de vendas
(pedido, item de cardápio, preço unitário, hora da venda).

Este documento define o que é comum aos seis módulos, as mudanças de modelo que a fundação exige,
o desenho de cada módulo e a ordem de entrega. O plano de execução de cada módulo (tasks, TDD)
é escrito na hora de atacá-lo, não aqui.

---

## Decisões já tomadas

Registradas porque moldam tudo o que vem abaixo:

| # | Decisão | Consequência |
|---|---|---|
| D1 | Vencimento vira campo na movimentação | Contas a pagar passam a existir; `defaultStatus` muda |
| D2 | Classificação contábil vira campo na categoria | DRE consegue separar CMV de despesa operacional |
| D3 | Imposto sai de alíquota configurada no restaurante | Movimentação de imposto vira só saída de caixa |
| D4 | Subcategoria é entidade de verdade, não agrupamento por título | Subitens de despesa são confiáveis |
| D5 | Canal vira campo na movimentação (marca despesa também) | Toggle Salão/Delivery funciona em Custos |
| D6 | Resposta devolve número cru; formatação é do front | Contrato difere do `Backend Pendente.html` |
| D7 | DRE/Receitas/Custos por competência; Fluxo de Caixa por caixa | Os dois números divergem por construção — é esperado |
| D8 | Receitas e Previsões entram por último | Dependem do domínio de vendas, que ainda não existe |

---

## Parte 1 — O que é comum aos seis módulos

### 1.1 A camada de relatórios

Módulo novo em `src/app/reports/`, um diretório por relatório, seguindo o padrão já praticado no
repositório. A separação interna é a mesma que `movement-rules.ts` e `money.ts` já usam hoje:

```
src/app/reports/
├── cash-flow/
│   ├── cash-flow-routes.ts
│   ├── cash-flow-controller.ts
│   ├── cash-flow-repository.ts        # agregação Mongo — devolve baldes crus
│   ├── cash-flow-metrics.ts           # regra pura — recebe baldes, calcula derivados
│   └── use-cases/
│       └── cash-flow.query.ts         # orquestra repositório + regra
├── result/
├── expenses/
└── shared/
    ├── period.ts                      # resolve period/from/to → intervalo com fuso
    ├── cash-date.ts                   # data de caixa de uma movimentação
    └── channel.ts                     # canal efetivo de uma movimentação
```

O sufixo `.query.ts` para use-case de leitura já existe no repositório
(`financial-category/use-cases/suggest-categories.query.ts`) — é o padrão que seguimos.

**Por que a regra pura fica fora do repositório:** é o que torna 90% de cobertura viável. Margem,
prime cost, ponto de equilíbrio, variação contra o período anterior e score de saúde são funções
de números para números — testáveis sem Mongo, em teste unitário rápido. O repositório fica com
uma responsabilidade só: rodar o pipeline e devolver baldes. O que ele devolve é testado em
integração com `mongodb-memory-server`.

**Três regras inegociáveis nessa camada:**

1. **Todo pipeline filtra por `restaurantId` do `RequestContext`.** Num CRUD, esquecer o filtro
   devolve um documento de outro tenant e alguém percebe. Num agregado, o vazamento vira um número
   maior no gráfico e ninguém percebe nunca. É a lição do C1/IDOR (PR #37) aplicada à leitura.
2. **Dinheiro é `Decimal128` até a borda.** `$sum` sobre `Decimal128` devolve `Decimal128`; a
   conversão para `number` acontece só ao montar a resposta, com o `decimalToNumber` que já existe
   em `core/money`.
3. **Índice junto com o relatório.** Cada módulo acrescenta o índice que seus pipelines pedem em
   `infrastructure/db/indices/financial-movements.ts`, e o `db:indices` já roda no deploy.

**Sem materialização.** Os agregados são calculados na hora, a cada request. O volume é de um
restaurante por mês — algumas centenas de documentos. Materializar snapshots mensais é uma
otimização com custo de invalidação alto (toda edição de movimento antigo suja o snapshot) que
não se justifica antes de medir. Se doer, medimos e materializamos depois.

### 1.2 Contrato de resposta (D6)

O `Backend Pendente.html` pede texto pronto do backend: `refLabel: 'Julho/2026'`,
`deltas: { receitaBruta: '+24,9%' }`, meses como `'Fev'`. **Não vamos fazer assim.** A API devolve
número cru e data ISO; a formatação em pt-BR é do front.

```ts
// Em vez de:  { refLabel: 'Julho/2026', deltas: { receitaBruta: '+24,9%' }, deltasUp: {...} }
// Devolvemos: { referenceMonth: '2026-07-01', deltas: { grossRevenue: 0.249 } }
```

O sinal do delta já diz se subiu ou desceu, então `deltasUp` deixa de existir. Campos como
`heatmapVazioMsg` e `pedidosLabel`, que são frase pronta, saem do contrato.

**Motivo:** formatação e locale no backend viram dívida na hora de mexer em qualquer label, e
teste que asserta string quebra por espaço em branco. Número é testável.

**Consequência assumida:** o MintlyWeb precisa adaptar os componentes que hoje só imprimem a
string que chega. Como o front não é escopo deste trabalho, isso é trabalho de quem cuidar dele —
e precisa ser combinado antes do primeiro módulo entrar, senão a tela quebra. Registrado nas
pendências.

Envelope segue o que já existe: `{ payload: T }`, via `ResponseBuilder`.

### 1.3 Períodos e fuso

Todo relatório com recorte temporal aceita a mesma query: `period` (`today` | `last7Days` |
`thisMonth` | `lastMonth` | `custom`) e, quando `custom`, `from`/`to` em ISO date.

Um helper compartilhado (`reports/shared/period.ts`) resolve isso num intervalo `[início, fim)`
usando o fuso **`America/Sao_Paulo`, fixo**. "Hoje" e "este mês" só significam alguma coisa com
fuso definido: em UTC, um lançamento das 22h de 31 de julho cairia em agosto e o mês fecharia
errado. Fuso configurável por restaurante fica nas pendências — todo cliente é brasileiro hoje.

**Qual data filtra o quê (D7):**

| Relatório | Data que manda | Por quê |
|---|---|---|
| Resultado, Custos, Receitas | `date` (competência) | O mês em que a venda/gasto aconteceu |
| Fluxo de Caixa | `dueDate` (caixa) | Quando o dinheiro entra ou sai |
| Visão Geral | ambas | Blocos de resultado por competência; caixa e projeção por caixa |

Os dois números vão divergir — é assim que tem que ser, e a tela explica isso ao usuário.

### 1.4 Os blocos de texto

As telas têm caixinhas de texto ("Custo dos ingredientes acima do ideal", "Seu caixa vai ficar
apertado por volta do dia 22"). Elas se dividem em dois tipos, e só um é escopo agora:

- **Determinístico** — sai de regra e cálculo: anomalia de despesa contra a média dos últimos
  3 meses, menor saldo do horizonte e em que dia ele cai, dia crítico, ponto de equilíbrio
  atingido. **Entra junto com o módulo**, como dado estruturado (`severity`, `title`, valores),
  não como frase montada.
- **Narrativo** — "Leitura do mês", "O que fazer primeiro" com texto corrido explicando o
  negócio. **Fica para a fase de IA**, depois que os módulos estiverem prontos.

Os endpoints já nascem com o campo de insights na resposta, devolvendo só os determinísticos.

---

## Parte 2 — Mudanças de modelo (a fundação)

Cinco mudanças. Cada uma entra fatiada, logo antes do módulo que precisa dela — não num PR grande
de preparação que fica meses sem uso.

### M1. `dueDate` na movimentação (D1)

**Problema.** `defaultStatus` (`movement-rules.ts:38`) devolve `settled` para toda saída — "prazo
só vale p/ recebimento". E `predictedReceiptDate` só é calculado para entrada em conta `platform`.
Mas o Fluxo de Caixa mostra "Fornecedor Hortifruti · vence em 19 de out. · Previsto" e "Vencido".
Conta a pagar não está modelada: não há onde guardar o vencimento de uma saída.

**Decisão — unificar vencimento num campo só.** As duas coisas que a tela chama de "vencimento"
— o repasse do iFood que cai em 19 de outubro e o boleto do fornecedor que vence em 19 de outubro
— são o mesmo conceito: *quando o dinheiro encosta no caixa*. Modelar isso em dois campos
(`predictedReceiptDate` para entrada de plataforma, `dueDate` para o resto) cria duas fontes para
a mesma pergunta e obriga todo consumidor a fazer `dueDate ?? predictedReceiptDate ?? date`.

Então: **`dueDate` substitui `predictedReceiptDate`.**

```ts
// financialMovementSchema (base)
dueDate: s.date().coerce().optional(),   // quando o dinheiro entra/sai
// predictedReceiptDate: REMOVIDO (breaking — lib major)
```

- **Entrada em conta `platform`**: o sistema calcula, como hoje — `dueDate = date + settlementDaysApplied`.
  O snapshot congelado (P3) continua valendo: `settlementDaysApplied` e `feePercentApplied` não mudam.
- **Saída ou entrada a prazo**: o dono informa. Ausente = à vista.

**`defaultStatus` passa a ser uma regra só, sem olhar direção:**

```
status = pending  se dueDate > hoje
       = settled  caso contrário
```

Para entrada em conta `platform` com prazo, o resultado é idêntico ao de hoje (o `dueDate`
calculado é futuro → `pending`). Para saída com boleto, passa a nascer `pending` — que é o
comportamento que a tela pede. `cancelled` segue fora dessa regra, e a invariante do
`resolveStatusSource` (pendente sem data de vencimento é inalcançável pelo robô, logo `manual`)
continua valendo, agora ancorada em `dueDate`.

**O settler** passa a filtrar por `dueDate <= hoje` em vez de `predictedReceiptDate <= hoje`, e
liquida saída também — o que estava vencido e não foi pago vira pago na data. Campo ausente
continua não casando o filtro, então a invariante que protege o backlog antigo é a mesma.

**Efeito colateral bom: isso fecha o P8.** O P8 (`PROBLEMAS-FUTUROS.md`) é a troca de conta a
partir de `settled` que não recomputa o status — um recebível de cartão lançado em conta cash
fica contabilizado como caixa em mãos. Com a regra acima, o status deixa de ser uma decisão
tomada uma vez no registro e passa a ser **função de `dueDate`**, recomputada em toda escrita,
com uma única guarda: `statusSource === 'manual'` trava. Como o settler só liquida o que tem
`dueDate <= hoje`, recomputar nunca desfaz liquidação legítima. A confirmação disso é um teste
do ida-e-volta conta cash ↔ conta plataforma, no PR 1.

**Migração.** Script `db:backfill-due-date` copia `predictedReceiptDate` → `dueDate` nos
documentos existentes, no mesmo formato dos scripts que já existem em `scripts/`. Sem o backfill,
o backlog de pendentes fica invisível para o settler.

**Alternativa considerada e recusada:** manter os dois campos convivendo, com `dueDate` só para
saída. Evita o breaking change e não mexe no settler, que acabou de passar por review. Recusada
porque deixa permanente uma duplicação de conceito que todo relatório teria que desempatar, e
porque o breaking change é barato agora: `main` está na release de 10/06 e só `staging` tem o
domínio financeiro.

### M2. `dreGroup` na categoria + `behavior: mixed` (D2)

**Problema.** A categoria tem `type` (revenue/expense), `behavior` (fixed/variable) e
`operationalNature`. O DRE precisa de mais: separar CMV de pró-labore, de imposto e das demais
despesas operacionais. E as telas mostram **"Misto"** como terceiro valor de comportamento
(Utilidades, na tela de Custos).

**Decisão.**

```ts
export enum DreGroup {
  Cmv = 'cmv',       // ingredientes e insumos — entra na margem bruta
  Labor = 'labor',   // pró-labore, salários — compõe o prime cost
  Tax = 'tax',       // imposto — NÃO entra em despesa operacional (ver M5)
  Opex = 'opex',     // demais despesas operacionais
}

export enum CategoryBehavior {
  Fixed = 'fixed',
  Variable = 'variable',
  Mixed = 'mixed',   // NOVO
}
```

`dreGroup` só faz sentido em categoria de despesa. O Sapphire não tem `refine`, então a
coerência vai por **união discriminada por `type`** — o mesmo recurso que o
`financialAccountSchema` já usa para platform × demais, e que está registrado como o jeito de
fazer validação condicional na lib:

```ts
const revenueCategorySchema = baseCategorySchema.extend({
  type: s.type().literal(CategoryType.Revenue),
  // sem dreGroup
})

const expenseCategorySchema = baseCategorySchema.extend({
  type: s.type().literal(CategoryType.Expense),
  dreGroup: s.type().enum(DreGroup),
})

export const financialCategorySchema = s.type().union([revenueCategorySchema, expenseCategorySchema])
```

O schema de update continua objeto achatado `.partial()` (união não tem `.partial()`), e a
coerência contra o tipo armazenado é validada na API — exatamente o padrão do `account-rules.ts`
resolvido no P5.

**Migração.** Categorias existentes não têm `dreGroup`. Backfill com `opex` como padrão, e as
categorias de sistema (`isSystem: true`) recebem o grupo correto por nome no próprio script. O
dono corrige o que ficar errado pelo PATCH.

**`Mixed` no ponto de equilíbrio.** Uma despesa mista não é nem fixa nem variável, mas o ponto de
equilíbrio precisa de uma divisão binária. Proposta: **misto conta como fixo** — é a leitura
conservadora (ponto de equilíbrio mais alto, o dono não se ilude). Na tela de Custos ele aparece
como "Misto", sem tradução. Confirmar com o time de negócio; está nas pendências.

### M3. `channel` na movimentação (D5)

**Problema.** As telas filtram por Geral / Salão / Delivery. O tipo da conta resolve metade: uma
entrada em conta `platform` é delivery. Não resolve (a) despesa compartilhada — aluguel, energia,
pró-labore não são de canal nenhum; (b) delivery próprio pago em pix, que cai numa conta cash e
seria contado como salão.

**Decisão.** Campo opcional na movimentação:

```ts
export enum MovementChannel {
  DineIn = 'dineIn',     // salão
  Delivery = 'delivery',
  Shared = 'shared',     // da casa inteira — aluguel, energia, contador
}

channel: s.type().enum(MovementChannel).optional(),
```

Resolução do canal efetivo, numa função pura (`reports/shared/channel.ts`), quando o campo está
ausente:

- **Entrada**: conta `platform` → `delivery`; demais → `dineIn`.
- **Saída**: `shared`.

Assim o dado antigo continua legível sem backfill, e o dono só marca quando quer precisão. O
filtro "Delivery" mostra o que é do delivery; despesa `shared` aparece só em "Geral".

**Fora de escopo:** ratear despesa compartilhada entre canais (proporcional à receita, por
exemplo) para dar um lucro por canal. É decisão de negócio e está nas pendências.

### M4. Subcategoria (D4)

**Problema.** Na tela de Custos, abrir CMV/Insumos mostra Frango R$ 12.500, Óleo R$ 2.800,
Embalagens R$ 2.400 marcado "fora do padrão". Isso é um nível abaixo da categoria, e hoje não
existe.

**Decisão — subcategoria embutida no documento da categoria**, não em coleção própria:

```ts
// dentro de financialCategorySchema
subcategories: s.array(
  s.object({
    _id: s.string(),
    name: s.string(),
    status: s.type().enum(RecordStatus),
  }),
).default([]),
```

E no movimento, *extended reference* — o mesmo padrão que `account` e `category` já usam:

```ts
subcategory: s.object({ _id: s.string(), name: s.string() }).optional(),
```

**Por que embutido.** São poucas por categoria (cinco a dez), são sempre lidas junto com a
categoria e mudam pouco. Coleção separada obrigaria um `$lookup` em todo relatório de custo para
ganhar nada — o documento de categoria continua pequeno e longe de qualquer limite. Renomear uma
subcategoria mexe num documento só, e os movimentos guardam o snapshot do nome, mantendo a
fidelidade histórica que o resto do modelo já pratica.

**Trade-off assumido:** não dá para consultar subcategoria sem passar pela categoria, e uma
eventual listagem global de subcategorias exige `$unwind`. Nenhuma tela pede isso.

O CRUD de subcategoria entra como sub-recurso de categoria
(`POST /financial-categories/:id/subcategories` e afins), e o registro de movimento passa a
aceitar `subcategoryId` opcional, validando que ela pertence à categoria informada.

### M5. Alíquota tributária no restaurante (D3)

**Problema.** O DRE tem a linha "(−) Impostos sobre venda: R$ 3.504,00", que é exatamente 6% de
R$ 58.400. E o Fluxo de Caixa mostra uma movimentação "Simples Nacional · Impostos · R$ 3.700".
São a mesma coisa vista de dois ângulos: competência e caixa.

**Decisão.** `restaurantSchema` ganha a configuração tributária:

```ts
taxRatePercent: s.number().min(0).max(100).default(0),   // alíquota efetiva sobre a receita bruta
taxRegime: s.type().enum(TaxRegime).optional(),          // simplesNacional | lucroPresumido | ...
```

No DRE: `impostos = receitaBruta × taxRatePercent / 100`.

**Regra que evita contar duas vezes:** a movimentação de imposto (categoria com
`dreGroup: 'tax'`) é **saída de caixa e só isso**. Ela aparece no Fluxo de Caixa e é
**excluída de `despesasOperacionais`** no DRE — senão o imposto entraria na conta duas vezes, uma
como dedução da receita e outra como despesa, e o lucro sairia menor do que é.

**Pendência:** o Simples Nacional tem faixas por RBT12, então a alíquota efetiva varia com o
faturamento dos últimos 12 meses. Por ora o dono informa a alíquota efetiva na mão. Calcular a
faixa está nas pendências.

### M6. A taxa de plataforma não é despesa lançada

Não é mudança de schema, é uma regra que precisa estar escrita antes de alguém modelar errado.

A tela de Custos mostra "Taxa iFood R$ 6.044,00" como uma linha de despesa. No modelo atual essa
taxa **já existe**: é o `feeValue` do movimento, descontado do `netValue` no registro. Como a
receita bruta do DRE soma `grossValue`, a taxa precisa aparecer em algum lugar do lado do custo —
senão o lucro fica inflado.

**Decisão:** a taxa de plataforma é uma **linha sintética**, derivada de `Σ feeValue` das entradas
do período. Nunca é lançada como movimentação de despesa. Se o dono lançar uma despesa "Taxa
iFood" na mão, o número conta duas vezes — a proteção contra isso (validação ou alerta) está nas
pendências.

---

## Parte 3 — Os módulos

### 3.1 Fluxo de Caixa — `GET /reports/cash-flow?horizon=30`

Depende de: **M1**.

| Bloco da tela | Como sai |
|---|---|
| Caixa hoje | Σ `availableBalance` das contas ativas — já existe |
| A receber / A pagar no horizonte | Σ pendentes com `dueDate` dentro do horizonte, por direção |
| Projeção de caixa | Para cada dia `d`: caixa hoje + Σ entradas pendentes até `d` − Σ saídas pendentes até `d` |
| Menor saldo e em que dia | Mínimo da série projetada |
| Série realizada (7 dias) | Retroage a partir do caixa de hoje, desfazendo o que liquidou em cada dia |
| Entradas × Saídas por semana | Agrupamento semanal dentro do horizonte |
| Próximos vencimentos | Pendentes no horizonte, com filtro a receber / a pagar / vencidos |
| Vencidos | `status: pending` e `dueDate < hoje` |
| Dia crítico | Determinístico: dia em que o saldo projetado fica abaixo do limiar |

Sinal e valor seguem o `balanceImpact` que já existe: entrada soma `netValue`, saída subtrai
`grossValue`.

**Não temos histórico de saldo.** A série realizada é reconstruída para trás a partir do saldo de
hoje. Isso é correto enquanto ninguém edita movimento antigo com data retroativa; guardar
snapshot diário de saldo é o remédio se virar problema, e está nas pendências.

### 3.2 Resultado (DRE) — `GET /reports/result`

Depende de: **M2**, **M5**, **M6**.

```
receitaBruta          = Σ grossValue das entradas do mês (competência)
(−) impostos          = receitaBruta × taxRatePercent            ← M5
= receitaLiquida
(−) cmv               = Σ saídas com dreGroup 'cmv'              ← M2
(−) taxaPlataforma    = Σ feeValue das entradas do mês           ← M6
= margemBruta
(−) despesasOperacionais = Σ saídas com dreGroup 'labor' | 'opex' (exclui 'tax' e 'cmv')
= lucroLiquido
margemLiquida         = lucroLiquido / receitaBruta
```

Mais: comparação com o mês anterior em cada linha, histórico de 6 meses (lucro, margem, receita),
detalhamento das despesas operacionais por categoria e o bloco de ponto de equilíbrio:

```
custosFixos            = Σ saídas com behavior 'fixed' (+ 'mixed', ver M2)
custosVariaveis        = Σ saídas com behavior 'variable'
margemContribuicaoPct  = (receitaLiquida − custosVariaveis) / receitaLiquida
pontoEquilibrio        = custosFixos / margemContribuicaoPct
diasParaEquilibrio     = dia do mês em que a receita acumulada cruza o ponto de equilíbrio
```

### 3.3 Custos & Despesas — `GET /reports/expenses?period=`

Depende de: **M2**, **M3**, **M4**, **M6**. Fatiado em dois PRs.

**Fatia A — nível de categoria.** Total de despesas, CMV e CMV%, prime cost
(`cmv + labor`) e prime cost %, taxa de plataforma e seu % sobre o delivery, quebra fixo /
variável / misto, lista de categorias com valor, variação contra o mês anterior ou contra a média
de 3 meses, e alternância entre R$ e % da receita.

**Fatia B — subitens, anomalias e tendência.** Expansão da categoria em subcategorias com valor do
mês, do mês anterior e média dos últimos 3 meses; tendência de 6 meses por categoria com projeção
do mês corrente; e a detecção de salto atípico.

**Anomalia — a regra proposta:** um subitem é anômalo quando o valor do mês supera a média dos
três meses anteriores em **≥ 50%** e o excedente é **≥ R$ 100**. O piso em reais evita que um item
de R$ 20 que virou R$ 40 dispare alerta. Os dois números são chute informado a partir das prints
(Embalagens +66%, Gás +56%) e precisam de validação do time de negócio — estão nas pendências.

### 3.4 Visão Geral — `GET /dashboard/overview`

Depende de: **3.1**, **3.2**, **3.3**. É composição, mais dois cálculos próprios.

Reaproveita as queries dos outros três em vez de reimplementar os pipelines — é o principal motivo
de ela vir por último.

**Fôlego de caixa:** `caixa hoje / despesa média diária dos últimos 90 dias`, em dias.

**Score de saúde (0–100).** A tela mostra um anel com nota, um rótulo (risco / atenção / saudável)
e os pilares com peso e nota individual. A composição proposta:

| Pilar | Peso | Nota 100 quando |
|---|---|---|
| Margem líquida | 30% | ≥ 10% |
| Fôlego de caixa | 30% | ≥ 45 dias |
| Prime cost | 25% | ≤ 60% da receita |
| Tendência de receita | 15% | crescendo contra os 3 meses anteriores |

Nota final é a média ponderada; rótulo por faixa (< 40 risco, < 70 atenção, ≥ 70 saudável). Os
alvos de CMV (28–35%) e prime cost (≤ 60–65%) que aparecem nas telas são benchmark de restaurante
— entram como constantes do domínio, com a origem comentada no código. Pesos, faixas e alvos
precisam de validação do time de negócio; estão nas pendências.

### 3.5 Receitas — bloqueado

`GET /reports/revenue` pede `pedidos`, `ticketMedio`, `itens` do cardápio (nome, categoria, preço,
custo, quantidade vendida, margem), `formasPagamento`, `canais` e `heatmap` de dia × faixa
horária. Nada disso existe.

Parte é derivável hoje (receita por categoria, por canal, tendência de 6 meses, formas de
pagamento a partir do `paymentMethod` da movimentação). Pedido, ticket médio, cardápio e heatmap
não são. Além disso, **as telas de Receitas não vieram nas prints** — só um fragmento de
"Tendência de receita".

Fica para depois do domínio de vendas. Registrado nas pendências.

### 3.6 Previsões — bloqueado

`GET /predictions/base-data` e a projeção de caixa/lucro saem do histórico de movimentações e
seriam factíveis. Mas `/menu-items` e `POST /predictions/simulate` (ajustes de preço, volume e
custo) dependem do cardápio com preço e custo unitário — mesmo bloqueio de Receitas.

O método de projeção que a tela anuncia ("média móvel + tendência de 6 meses", com faixa provável)
também precisa ser especificado antes de virar código.

### 3.7 Avulsos

Independentes dos seis módulos, entram quando fizer sentido:

- **Import em massa de movimentações** (`/financial-movements/import/preview` e `/confirm`) —
  parser de `.xlsx`, validação linha a linha e confirmação transacional. Não depende de nada da
  fundação além de `dueDate` e subcategoria, se quiser importar esses campos.
- **Notificações** — a coleção e as rotas são triviais; a única regra prevista hoje
  (`type: 'preco-parado'`) depende do cardápio, então nasce sem gatilho.
- **Avatar de perfil** — precisa decidir onde o arquivo mora. O filesystem da Vercel é efêmero,
  então não serve; S3, GridFS ou equivalente. Está nas pendências.

---

## Parte 4 — Testes

A estratégia de teste do repositório não muda; muda o que cai em cada camada.

- **Unitário** (`*.spec.ts`) — toda regra pura: métricas, deltas, ponto de equilíbrio, score de
  saúde, resolução de período e fuso, canal efetivo, detecção de anomalia. É onde a maior parte da
  cobertura dos relatórios vai morar.
- **Integração** (`*.int.spec.ts`) — os pipelines de agregação com `mongodb-memory-server`,
  plantando movimentações conhecidas e assertando os números. Inclui, obrigatoriamente, um teste
  de **isolamento de tenant** por relatório: dois restaurantes com dados, e o agregado de um não
  pode enxergar o outro.
- **E2E local** (`tests/e2e/`) — a rota de ponta a ponta contra o Atlas, como já é feito.

**Validação dos números sem tela.** Como o front não é escopo, o passo "abrir a tela e conferir"
vira: um script `db:seed-demo` planta um mês determinístico (o mesmo cenário das prints, com
totais conhecidos), e a conferência é feita chamando os endpoints pelo Insomnia — a collection já
existe em `insomnia/` — contra uma planilha de valores esperados. Isso também serve de fixture
para os testes de integração.

Threshold de 90% em lines, statements, branches e functions continua valendo.

---

## Parte 5 — Ordem de entrega

Nove fatias. Cada uma é **um PR na MintlyLib** (schemas, tipos de resposta e client HTTP) e **um
PR na MintlyApi** — o mesmo par que o PR #25 / #38 já praticou. A fundação entra fatiada, cada
pedaço imediatamente antes do módulo que o consome.

| # | Fatia | Lib | API | Destrava |
|---|---|---|---|---|
| 1 | `dueDate` (M1) | campo, remoção de `predictedReceiptDate`, schemas de registro/edição | `defaultStatus`, settler, backfill, índices | Contas a pagar; fecha o P8 |
| 2 | **Fluxo de Caixa** | tipos + client | `reports/cash-flow` | — |
| 3 | `dreGroup` + `mixed` + alíquota (M2, M5) | união discriminada na categoria, config no restaurante | validação, backfill, seed das categorias de sistema | Corte contábil |
| 4 | **Resultado (DRE)** | tipos + client | `reports/result` | — |
| 5 | Subcategoria + `channel` (M3, M4) | subdocs na categoria, campo no movimento | CRUD de sub-recurso, `subcategoryId` no registro | Subitens e filtro por canal |
| 6 | **Custos & Despesas — fatia A** | tipos + client | `reports/expenses`, nível de categoria | — |
| 7 | **Custos & Despesas — fatia B** | — | subitens, anomalias, tendência | — |
| 8 | **Visão Geral** | tipos + client | `dashboard/overview`, score e fôlego | — |
| 9 | Receitas, Previsões | — | — | **Bloqueado**: domínio de vendas |

Avulsos (import, notificações, avatar) entram fora dessa trilha, quando houver espaço.

Cada fatia segue o ciclo combinado: perguntas do módulo → plano próprio → TDD → conferência dos
números contra o seed → PR.

---

## Parte 6 — Fora de escopo

Registrado aqui e mantido vivo em `specs/modulos-novos/pendencias-negocio.md`:

- Domínio de vendas: pedido, item de cardápio, preço e custo unitário, hora da venda.
- Telas de Receitas (não vieram nas prints).
- Rateio de despesa compartilhada entre canais.
- Textos narrativos gerados por IA.
- Faixas do Simples Nacional por RBT12.
- Alvos de benchmark, pesos do score de saúde e limiar de anomalia — validação com negócio.
- Adaptação do MintlyWeb ao contrato com número cru.
- Armazenamento de arquivo para o avatar.

---

## Self-review

- **Placeholders:** nenhum "TBD" ou seção vazia. Os números que são chute (limiar de anomalia,
  pesos do score, alvos de benchmark) estão marcados como tal e listados nas pendências.
- **Consistência:** a ordem de entrega da Parte 5 bate com as dependências declaradas em cada
  módulo da Parte 3. M1 fecha o P8, e isso está afirmado nos dois lugares com a mesma justificativa.
- **Escopo:** o documento é um roteiro de nove fatias, não um plano de implementação. Cada fatia
  ganha o seu próprio plano na hora de ser atacada — é o que evita que este arquivo vire um
  monólito de mil linhas.
- **Ambiguidade:** "vencimento" era o termo ambíguo (recebimento previsto × data de pagar o
  boleto); M1 resolve unificando em `dueDate` e o documento passa a usar só esse nome. "Despesa"
  também era ambíguo entre total e operacional; a Parte 3.2 fixa a fórmula de cada um.
