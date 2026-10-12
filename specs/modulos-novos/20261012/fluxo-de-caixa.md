# Fatia 2 — Fluxo de Caixa

`GET /reports/cash-flow` · épico **MIN-90** · história **MIN-94**

Roteiro geral: `specs/modulos-novos/20260929/design.md` (1.x e 3.1). Este documento detalha a
fatia; o que já está decidido lá não é repetido aqui.

---

## Contexto

O Fluxo de Caixa responde "quanto tenho hoje e como isso evolui nos próximos dias". Depende da
fatia 1 (`dueDate`, MintlyApi#39): sem vencimento não há o que projetar.

Fontes:

- **MIN-94** — 12 regras de negócio e 9 critérios de aceite.
- **Prints** — `Mintly/prints modulos novos/`, capturas `093958` a `094156` (8 telas).
- **`Backend Pendente.html`**, item 03 — contrato que o MintlyWeb esperava, ajustado pela D6
  (número cru, formatação no front).

O que as prints mostraram e a história não dizia:

1. A lista de vencimentos também olha **para trás**: mostra itens pagos/recebidos dos últimos dias
   ("Energia elétrica · Pago") e os vencidos em bloco vermelho "Em atraso".
2. O dia crítico **não** é "saldo negativo": o alerta "seu caixa vai ficar apertado por volta do
   dia 22" aparece com menor saldo de **+R$ 900**.

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| F1 | Vencidos entram na projeção **no dia de hoje** | O dinheiro ainda vai sair (ou entrar); só não se sabe quando. Leitura conservadora |
| F2 | A resposta destaca os vencidos: bloco `overdue` (quantidade e totais) e `overdue: true` por item | O front pinta diferente e explica quantos estão atrasados |
| F3 | Dia crítico = primeiro dia com saldo projetado **abaixo de 7 dias de despesa média** | Reproduz a print; escala com o porte do restaurante. Os 7 dias vão para as pendências (N13) |
| F4 | Movimentação ganha `settledAt` — quando o dinheiro de fato mexeu | Sem ele, boleto pago com atraso cai no dia do vencimento na série realizada |
| F5 | O repositório busca as linhas; o cálculo é uma função pura em TS | A lista precisa das linhas de qualquer jeito; volume pequeno; regra testável sem banco |
| F6 | Spec fica no repo; vira comentário na MIN-94 depois | MCP do Atlassian indisponível na sessão de 12/10 |

**Alternativas recusadas:**

- Dia crítico com limiar zero — só avisa quando já é tarde e não reproduz a tela.
- Agregação por dia no Mongo (`$group`) — segunda consulta sobre as mesmas linhas, regra de
  vencido/fuso dividida entre pipeline e TS. Fica como troca futura se o volume pesar; contrato e
  regra pura não mudam.
- Materializar a projeção — o design já recusa materialização antes de medir.

---

## Contrato

```
GET /reports/cash-flow?horizon=30
```

- `horizon`: inteiro de 1 a 365, padrão 30. Fora disso → 400.
- Autenticado (`verifyJwt`); restaurante vem do `RequestContext`.
- Envelope `{ payload: CashFlowReport }`, via `ResponseBuilder`.
- Datas são `AAAA-MM-DD` no fuso `America/Sao_Paulo`.

```ts
interface CashFlowReport {
  horizon: number
  today: string
  cashToday: number             // Σ availableBalance das contas ativas
  receivable: number            // entradas pendentes até o fim do horizonte (inclui vencidas)
  payable: number               // saídas pendentes até o fim do horizonte (inclui vencidas)
  projectedBalance: number      // cashToday + receivable − payable
  lowestBalance: { date: string; balance: number }
  overdue: { count: number; receivable: number; payable: number }
  safetyThreshold: { value: number; days: number; avgDailyOutflow: number }

  projection: DailyPoint[]      // hoje até hoje + horizon (horizon + 1 pontos)
  realized: DailyPoint[]        // os 7 dias anteriores a hoje
  weeks: { from: string; to: string; inflows: number; outflows: number }[]
  dueItems: DueItem[]
  insights: CashFlowInsight[]
}

interface DailyPoint { date: string; balance: number; inflows: number; outflows: number }

interface DueItem {
  id: string
  title: string
  category: { _id: string; name: string }
  direction: 'in' | 'out'
  amount: number                // entrada: netValue; saída: grossValue
  dueDate: string
  status: 'pending' | 'settled'
  overdue: boolean              // pendente com vencimento antes de hoje
  settledAt?: string
}

type CashFlowInsight =
  { kind: 'criticalDay'; severity: 'warning'; date: string; balance: number; threshold: number }
```

**Diferenças em relação ao `Backend Pendente.html`:** chaves em inglês; número cru; sem labels
prontas; sem `sparksFluxo` (o front deriva de `projection`, que traz entradas e saídas por dia);
dia crítico vem em `insights`, o campo de blocos determinísticos previsto em 1.4 do design.

**`dueItems`** traz só movimentação **com vencimento** — venda à vista não entra, senão a lista
vira extrato. Janela: vencidas de qualquer data + liquidadas nos últimos 7 dias + pendentes até o
fim do horizonte. Filtros (todos / a receber / a pagar / vencidos) e agrupamento por dia são do
front.

---

## Regra de cálculo

Função pura em `src/app/reports/cash-flow/cash-flow-metrics.ts`. Canceladas ficam fora de tudo.
Todo dia é uma data em `America/Sao_Paulo` (helper em `reports/shared/`).

### Data de caixa

| Situação | Dia que vale |
|---|---|
| Pendente com vencimento | `dueDate`; se antes de hoje, **hoje** (F1) |
| Pendente sem vencimento (dono forçou pendente) | `date`; se antes de hoje, hoje |
| Liquidada | `settledAt ?? dueDate ?? date` |

Valor: entrada soma `netValue`, saída subtrai `grossValue` — o mesmo `balanceImpact` do saldo.

### Projeção

```
saldo[hoje] = cashToday + Σ entradas pendentes de hoje − Σ saídas pendentes de hoje
saldo[d]    = saldo[d − 1] + entradas[d] − saídas[d]
```

`lowestBalance` é o mínimo da série; empate fica com o primeiro dia.

### Série realizada

```
saldo[ontem] = cashToday − (Σ entradas liquidadas hoje − Σ saídas liquidadas hoje)
saldo[d − 1] = saldo[d] − entradas liquidadas[d] + saídas liquidadas[d]
```

Usa todas as liquidadas, inclusive à vista. Reconstrução para trás — limitação registrada em N12.

### Limiar e dia crítico

```
diasDeHistorico = min(90, dias desde a primeira movimentação do restaurante), mínimo 1
avgDailyOutflow = Σ saídas liquidadas nos últimos 90 dias / diasDeHistorico
value           = avgDailyOutflow × SAFETY_DAYS          // SAFETY_DAYS = 7 (N13)
```

Dia crítico = **primeiro** dia da projeção com `saldo < value`. Nenhum dia abaixo → nenhum
insight. Sem histórico de saída, `value = 0` e só saldo negativo dispara.

### Semanas

Blocos de 7 dias a partir de hoje; o último pode ser menor (horizonte 30 → 4 blocos de 7 + 1 de
3, contando hoje). Somam entradas e saídas pendentes; vencidas caem no bloco 1.

### Consultas (repositório)

Todas filtram `restaurantId` do contexto.

1. **Linhas da janela** — não canceladas, e:
   - pendentes com data de caixa até o fim do horizonte (inclui vencidas de qualquer data);
   - liquidadas com data de caixa nos últimos 7 dias.
2. **Histórico de saída** — `Σ grossValue` das saídas liquidadas nos últimos 90 dias e a data da
   primeira movimentação do restaurante.
3. **Caixa hoje** — `Σ availableBalance` das contas ativas.

Índice: `{ restaurantId: 1, status: 1, dueDate: 1 }` já existe e serve os pendentes. As
liquidadas precisam de `{ restaurantId: 1, status: 1, settledAt: 1 }`; a forma final da consulta
das liquidadas (o `$or` do fallback para documentos antigos) é fixada no plano.

---

## `settledAt`

### Lib

```ts
// financialMovementSchema (base)
settledAt: s.date().coerce().optional(),   // quando o dinheiro de fato entrou/saiu
```

Opcional e aditivo — **minor de verdade**. O body do `PATCH /financial-movements/:id/status`
ganha `settledAt?: string | Date`.

### Quem grava (API)

A regra mora em `applyStatusTransition` (`movement-status.ts`), por onde passam as transições:

| Quando | `settledAt` |
|---|---|
| Registro que nasce liquidado (à vista) | `date` |
| Liquidação automática (settler) | `dueDate` — o repasse cai na data, mesmo que o robô rode às 3h do dia seguinte |
| `PATCH /:id/status` para liquidado | `settledAt` do body, ou agora. Data futura → 400 |
| Recompute por troca de conta que leva a liquidado | `date` |
| Volta para pendente ou cancelado | removido (`$unset`) |

**Sem migração.** Documento antigo sem o campo cai em `dueDate ?? date`, que é exatamente o que o
settler teria gravado.

---

## Estrutura

### MintlyLib

```
src/core/data/financial/financial-movement-schema.ts   # + settledAt
src/core/data/financial/financial-movement-response.ts # + settledAt no body do PATCH status
src/core/data/reports/cash-flow-response.ts            # tipos do contrato (novo)
src/core/data/reports/index.ts                         # (novo)
src/clients/report-client.ts                           # ReportClient.cashFlow (novo)
src/core/client/master-client.ts                       # + reports
```

`ReportClient` recebe os próximos relatórios (`result`, `expenses`) como métodos.

### MintlyApi

```
src/app/reports/
├── cash-flow/
│   ├── cash-flow-routes.ts
│   ├── cash-flow-controller.ts
│   ├── cash-flow-repository.ts       # as três consultas
│   ├── cash-flow-metrics.ts          # regra pura
│   └── use-cases/cash-flow.query.ts  # orquestra
└── shared/
    ├── period.ts                     # dia em America/Sao_Paulo, soma de dias
    └── cash-date.ts                  # data de caixa de uma movimentação
src/app/financial-movement/movement-status.ts          # settledAt nas transições
src/app/financial-movement/use-cases/*                 # PATCH status aceita settledAt
src/infrastructure/db/indices/financial-movements.ts   # índice de settledAt
scripts/app/seed-demo.ts                               # cenário do Fluxo de Caixa (novo)
insomnia/MintlyApi.insomnia_v4.json                    # + GET /reports/cash-flow
```

`period.ts` nasce só com o que o Fluxo de Caixa usa (dia local, soma de dias). Os períodos da
MIN-82 (`thisMonth`, `lastMonth`, …) entram com o primeiro relatório que os consumir.

---

## Testes

**Unitário** — onde mora a maior parte da cobertura:

- data de caixa: pendente, vencida → hoje, liquidada com e sem `settledAt`, pendente sem vencimento;
- projeção dia a dia com `netValue` × `grossValue`; menor saldo com empate;
- série realizada a partir do caixa de hoje;
- limiar com menos de 90 dias de histórico e sem histórico; dia crítico no primeiro dia e em hoje;
- semanas com bloco final menor e vencidas no bloco 1;
- fuso: lançamento às 22h fica no próprio dia;
- `applyStatusTransition` gravando/removendo `settledAt` em cada linha da tabela acima.

**Integração** (`mongodb-memory-server`, `fastify.inject`):

- cenário da print plantado; caixa hoje, a receber, a pagar, previsto, menor saldo, vencidos e dia
  crítico conferidos;
- **isolamento de tenant**: dois restaurantes, um não enxerga o outro;
- `horizon` inválido (0, 366, texto) → 400; sem token → 401;
- `PATCH /:id/status` com e sem `settledAt`, futura recusada;
- settler e registro à vista gravando o `settledAt` certo.

**E2E** (local, Atlas): registrar saída com vencimento e vê-la no relatório por HTTP real — fecha
também a lacuna de E2E da fatia 1.

**Conferência sem tela:** `npm run db:seed-demo` planta o cenário do Fluxo de Caixa relativo a
"hoje" (vencidas, pagos/recebidos recentes, concentração de saídas que gera o dia crítico), com os
valores esperados escritos no próprio script. A conferência é pelo Insomnia. O mesmo cenário é a
fixture do teste de integração, para não divergirem. Próximas fatias acrescentam seus cenários.

Threshold de 90% nas quatro métricas.

---

## Critérios de aceite (MIN-94) → onde são provados

| # | Critério | Teste |
|---|---|---|
| 1 | Trocar o horizonte recalcula todos os blocos | integração: mesmo cenário com 30 e 60 |
| 2 | Caixa hoje = Σ disponível das contas ativas | integração (conta inativa fora) |
| 3 | A receber/pagar só pendentes no horizonte | unitário + integração |
| 4 | Projeção bate dia a dia | unitário |
| 5 | Menor saldo e dia corretos | unitário |
| 6 | Vencidos destacados e separáveis | unitário (`overdue`) + integração |
| 7 | Dia crítico sinalizado ao cruzar o limiar | unitário |
| 8 | Isolamento entre restaurantes | integração |
| 9 | Cobertura ≥ 90% | CI |

---

## Entrega

Dois PRs, como na fatia 1:

1. **MintlyLib** — `feat/20261012/fluxo-de-caixa`, a partir de `staging`. Commit `feat(...)`,
   sem `!`: nada quebra.
2. **MintlyApi** — `feat/20261012/fluxo-de-caixa`, empilhada sobre
   `feat/20260929/status-por-vencimento` (#39) até ele ser mergeado; depois rebase em `staging`.

Nenhum comando novo no ambiente: `settledAt` não tem migração e o índice sobe com o
`db:indices` do deploy.

---

## Fora de escopo

- Insights narrativos ("considere antecipar recebimentos…") — fase de IA.
- Snapshot diário de saldo (N12).
- Fuso por restaurante (N11).
- Limiar configurável pelo dono — a constante basta até o negócio validar N13.

---

## Self-review

- **Placeholders:** nenhum. A chave exata do índice das liquidadas fica para o plano, declarada.
- **Consistência:** `projectedBalance` = último ponto de `projection`, porque vencidos entram em
  `receivable`/`payable` e em hoje na projeção (F1). Semana 1 também os soma.
- **Ambiguidade:** "data de caixa" está definida numa tabela única e é o termo usado em todo o
  resto. "Liquidadas nos últimos 7 dias" usa a mesma definição.
- **Escopo:** um endpoint, um campo novo e um seed; cabe num plano.
