# Fatia 2 — Fluxo de Caixa (MIN-94) — plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Cada passo é uma ação de 2 a 5
> minutos, na ordem escrever o teste que falha → ver falhar → implementar o mínimo
> → ver passar → commitar. Não pule o "ver falhar": um teste que passa antes da
> implementação não está testando o que você acha.

**Goal:** entregar `GET /reports/cash-flow` (caixa hoje, a receber/a pagar,
projeção diária, série realizada, semanas, vencimentos e dia crítico) e o campo
`settledAt` que diz quando o dinheiro de fato mexeu.

**Architecture:** o repositório faz três consultas simples e devolve linhas; uma
função pura (`cash-flow-metrics.ts`) calcula tudo em centavos. Datas são dias
`AAAA-MM-DD` em `America/Sao_Paulo`, resolvidos por um helper compartilhado.
`settledAt` nasce de uma regra pura (`resolveSettledAt`) usada por todas as
transições de status.

**Tech Stack:** TypeScript, Fastify 5, MongoDB (driver nativo, transações),
Sapphire, Jest na lib, Vitest na API, `mongodb-memory-server` na integração.

**Spec:** `specs/modulos-novos/20261012/fluxo-de-caixa.md` (aprovada em 12/10/2026).
Roteiro geral: `specs/modulos-novos/20260929/design.md`.

**Jira:** épico **MIN-90**, história **MIN-94**. Spec e plano ainda não postados
(MCP do Atlassian indisponível) — ver `andamento.md`.

## Global Constraints

- Nomes em inglês; campos em camelCase; collections em snake_case plural.
- Commits em português, conventional commits, escopo quando fizer sentido; rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura mínima de 90% em lines, statements, branches e functions (`npm run test:ci`).
- Dinheiro: `Decimal128` na persistência, `number` no domínio, **centavos inteiros** dentro do cálculo do relatório (`toCents`/`fromCents` de `core/money`).
- Toda consulta do relatório filtra `restaurantId` do `RequestContext`.
- Datas do contrato são `AAAA-MM-DD` no fuso `America/Sao_Paulo`; nunca `toISOString().slice(0, 10)` sobre um instante.
- `horizon`: inteiro de 1 a 365, padrão 30.
- `SAFETY_DAYS = 7`, `REALIZED_DAYS = 7`, `OUTFLOW_HISTORY_DAYS = 90`, `WEEK_DAYS = 7`.
- Lib: commit `feat(...)` **sem `!`** — `settledAt` é aditivo e opcional.
- Branches: `feat/20261012/fluxo-de-caixa` nos dois repositórios. Na API ela está empilhada sobre `feat/20260929/status-por-vencimento` (#39).

## Review Focus

Condições que a spec implica e que um teste "do caminho feliz" não pegaria — cada
uma tem teste na tarefa dona do código:

1. **Lançamento à noite** (22h em São Paulo = 01h UTC do dia seguinte) tem que cair no próprio dia, em todo cálculo. → Tarefa 5 (`toLocalDay`) e Tarefa 6 (`cashDay`).
2. **Relógio do cliente adiantado** ao mandar `settledAt` = "agora" não pode virar 400. → Tarefa 4 (tolerância de 5 minutos).
3. **Restaurante sem nenhuma movimentação** não pode quebrar o relatório (divisão por zero, `points[0]` inexistente, `firstMovementDay` nulo). → Tarefa 7 e Tarefa 9.
4. **Documento antigo** (sem `settledAt`, liquidado) tem que entrar na série realizada e na lista pelo fallback `dueDate ?? date`. → Tarefa 6 e Tarefa 8.
5. **Movimentação cancelada** com vencimento no horizonte não pode aparecer em nenhum número nem na lista. → Tarefa 7 e Tarefa 9.

---

## File Structure

**MintlyLib**

| Arquivo | Responsabilidade |
|---|---|
| `src/core/data/financial/financial-movement-schema.ts` | `settledAt` opcional no schema base |
| `src/core/data/financial/financial-movement-response.ts` | `ChangeMovementStatusRequest` (status + `settledAt?`) |
| `src/clients/financial-movement-client.ts` | `changeStatus` aceita `{ settledAt }` |
| `src/core/data/reports/cash-flow-response.ts` | Tipos do contrato do relatório |
| `src/core/data/reports/index.ts` | Barrel |
| `src/clients/report-client.ts` | `ReportClient.cashFlow` |
| `src/core/client/master-client.ts` | `reportClient` |

**MintlyApi**

| Arquivo | Responsabilidade |
|---|---|
| `src/app/financial-movement/movement-rules.ts` | `resolveSettledAt` (pura) |
| `src/app/financial-movement/movement-status.ts` | Grava/remove `settledAt` na transição |
| `src/app/financial-movement/use-cases/settle-due-movements.use-case.ts` | Liquida com `settledAt = dueDate` |
| `src/app/financial-movement/use-cases/register-movement.use-case.ts` | À vista nasce com `settledAt = date` |
| `src/app/financial-movement/use-cases/update-movement.use-case.ts` | Preserva/gera/remove `settledAt` |
| `src/app/financial-movement/use-cases/change-movement-status.use-case.ts` | Aceita `settledAt` informado (`parseSettledAt`) |
| `src/core/errors/core/validation-error.ts` | Erro 400 de regra (`APP-0005`) |
| `src/app/reports/shared/period.ts` | Dia local, soma/diferença de dias, início do dia |
| `src/app/reports/shared/cash-date.ts` | `CashFlowMovement`, `cashDay`, `cashAmount`, `isOverdue` |
| `src/app/reports/cash-flow/cash-flow-metrics.ts` | Toda a regra do relatório (pura) |
| `src/app/reports/cash-flow/cash-flow-repository.ts` | As três consultas |
| `src/app/reports/cash-flow/use-cases/cash-flow.query.ts` | Orquestra relógio + repositório + métricas |
| `src/app/reports/cash-flow/cash-flow-controller.ts` / `cash-flow-routes.ts` | Borda HTTP |
| `src/app/reports/cash-flow/cash-flow-scenario.ts` | Cenário determinístico (seed + fixture de integração) |
| `src/infrastructure/db/indices/financial-movements.ts` | Índice de `settledAt` |
| `src/infrastructure/server/build-server.ts` | Registra `/reports` no escopo protegido |
| `scripts/app/seed-demo.ts` | `npm run db:seed-demo` |
| `tests/e2e/cash-flow.e2e.spec.ts` | Saída com vencimento aparecendo no relatório por HTTP real |
| `insomnia/MintlyApi.insomnia_v4.json` | Requisição `GET /reports/cash-flow` |

O cenário fica em `src/` (e não em `tests/` ou `scripts/`) porque o `tsconfig`
tem `rootDir: "src"`: o teste de integração não pode importar de fora, e o script
já importa de `src/` hoje.

---

## Tarefa 1 — MintlyLib: `settledAt` no contrato

**Repositório:** MintlyLib · **Branch:** `git checkout staging && git pull && git checkout -b feat/20261012/fluxo-de-caixa`

**Files:**
- Modify: `src/core/data/financial/financial-movement-schema.ts` (logo depois de `dueDate`)
- Modify: `src/core/data/financial/financial-movement-response.ts`
- Modify: `src/clients/financial-movement-client.ts:42-45`
- Test: `src/core/data/financial/financial-movement-schema.spec.ts`
- Test: `src/clients/financial-movement-client.spec.ts` (novo)

**Interfaces:**
- Produces: `settledAt?: Date` no `financialMovementSchema`; `ChangeMovementStatusRequest { status: MovementStatus; settledAt?: string | Date }`; `FinancialMovementClient.changeStatus(id, status, headers, options?: { settledAt?: string | Date })`.

- [ ] **Passo 1: Testes do schema que falham**

No fim de `financial-movement-schema.spec.ts`:

```ts
describe('settledAt (fatia 2 — quando o dinheiro mexeu)', () => {
  it('aceita movimento liquidado com settledAt', () => {
    const doc = { ...validInMovement(), settledAt: new Date('2026-07-16T00:00:00.000Z') }
    expect(financialMovementSchema.safeParse(doc).success).toBe(true)
  })

  it('aceita movimento sem settledAt (documento antigo ou pendente)', () => {
    expect(financialMovementSchema.safeParse(validInMovement()).success).toBe(true)
  })

  it('coage settledAt em ISO string para Date', () => {
    const doc = { ...validInMovement(), settledAt: '2026-07-16T00:00:00.000Z' }

    const result = financialMovementSchema.safeParse(doc)

    expect(result.success).toBe(true)
    expect((result as any).data.settledAt).toBeInstanceOf(Date)
  })
})
```

- [ ] **Passo 2: Ver falhar**

Run: `npx jest src/core/data/financial/financial-movement-schema.spec.ts -t settledAt`
Expected: FAIL nos casos com `settledAt` (objeto estrito rejeita campo desconhecido).

- [ ] **Passo 3: Campo no schema**

Em `financial-movement-schema.ts`, logo abaixo de `dueDate: s.date().coerce().optional(),`:

```ts
  /**
   * Quando o dinheiro de fato entrou ou saiu. Preenchido pelo sistema ao
   * liquidar: data do lançamento (à vista), vencimento (liquidação automática)
   * ou o informado pelo dono no PATCH de status. Ausente em pendente/cancelado e
   * em documentos anteriores ao campo — quem lê usa `settledAt ?? dueDate ?? date`.
   *
   * Sem ele, um boleto pago com atraso apareceria no dia do vencimento na série
   * realizada do Fluxo de Caixa.
   */
  settledAt: s.date().coerce().optional(),
```

- [ ] **Passo 4: Ver passar**

Run: `npx jest src/core/data/financial/financial-movement-schema.spec.ts`
Expected: PASS (todos, inclusive os antigos).

- [ ] **Passo 5: Teste do client que falha**

Crie `src/clients/financial-movement-client.spec.ts`:

```ts
import { FinancialMovementClient } from './financial-movement-client'
import { MovementStatus } from '../core/data/financial/financial-movement-schema'

describe('FinancialMovementClient.changeStatus', () => {
  beforeAll(() => { process.env.BACK_END_URL = 'http://api.test' })

  const headers = { env: 'staging', authorization: 'Bearer t' } as any

  it('envia só o status quando settledAt não é informado', async () => {
    const client = new FinancialMovementClient()
    const patch = jest.spyOn((client as any).http.connection, 'patch').mockResolvedValue({ data: { payload: {} } } as any)

    await client.changeStatus('m1', MovementStatus.Settled, headers)

    expect(patch).toHaveBeenCalledWith('/m1/status', { status: MovementStatus.Settled }, expect.anything())
  })

  it('envia settledAt junto quando informado', async () => {
    const client = new FinancialMovementClient()
    const patch = jest.spyOn((client as any).http.connection, 'patch').mockResolvedValue({ data: { payload: {} } } as any)

    await client.changeStatus('m1', MovementStatus.Settled, headers, { settledAt: '2026-10-09' })

    expect(patch).toHaveBeenCalledWith(
      '/m1/status',
      { status: MovementStatus.Settled, settledAt: '2026-10-09' },
      expect.anything(),
    )
  })
})
```

- [ ] **Passo 6: Ver falhar**

Run: `npx jest src/clients/financial-movement-client.spec.ts`
Expected: FAIL no segundo caso (o body não leva `settledAt`) — e erro de tipo no quarto argumento.

- [ ] **Passo 7: Request e client**

Em `financial-movement-response.ts`, ao lado de `UpdateMovementRequest`:

```ts
/**
 * Corpo de PATCH /financial-movements/:id/status. `settledAt` só vale quando o
 * novo status é `settled`: é quando o dinheiro mexeu de fato (ex.: "paguei o
 * boleto na sexta e só lancei na segunda"). Ausente = agora. Data futura → 400.
 */
export interface ChangeMovementStatusRequest {
  status: MovementStatus
  settledAt?: string | Date
}
```

Em `financial-movement-client.ts`, importe `ChangeMovementStatusRequest` junto dos
outros tipos de `financial-movement-response` e troque o método:

```ts
  /** Muda o status (corrige saldo). `settledAt` informa quando o dinheiro mexeu; ausente = agora. */
  async changeStatus (
    id: string,
    status: MovementStatus,
    headers: Headers,
    options: { settledAt?: string | Date } = {},
  ): Promise<ResponseDto<FinancialMovement>> {
    const body: ChangeMovementStatusRequest = { status, ...options }
    const response = await this.http.connection.patch<ResponseDto<FinancialMovement>>(`/${id}/status`, body, withHeaders(headers))
    return response.data
  }
```

- [ ] **Passo 8: Ver passar + checagens**

Run: `npx jest && npm run typecheck && npm run lint`
Expected: tudo verde.

- [ ] **Passo 9: Commit**

```bash
git add src/core/data/financial/financial-movement-schema.ts src/core/data/financial/financial-movement-schema.spec.ts src/core/data/financial/financial-movement-response.ts src/clients/financial-movement-client.ts src/clients/financial-movement-client.spec.ts
git commit -m "feat(movimento): settledAt — quando o dinheiro de fato mexeu"
```

---

## Tarefa 2 — MintlyLib: tipos do relatório e `ReportClient`

**Files:**
- Create: `src/core/data/reports/cash-flow-response.ts`
- Create: `src/core/data/reports/index.ts`
- Modify: `src/core/data/index.ts`
- Create: `src/clients/report-client.ts`
- Modify: `src/clients/index.ts`, `src/core/client/master-client.ts`
- Test: `src/clients/report-client.spec.ts` (novo), `src/clients/client-shape.spec.ts`

**Interfaces:**
- Produces (exportados de `mintly-lib`): `CashFlowQuery`, `CashFlowReport`, `DailyPoint`, `CashFlowWeek`, `DueItem`, `CriticalDayInsight`, `CashFlowInsight`, `ReportClient`; `MasterClient.reportClient`.

- [ ] **Passo 1: Testes que falham**

Crie `src/clients/report-client.spec.ts`:

```ts
import { ReportClient } from './report-client'

describe('ReportClient', () => {
  beforeAll(() => { process.env.BACK_END_URL = 'http://api.test' })

  it('cashFlow faz GET /cash-flow com o horizonte na query e devolve o envelope', async () => {
    const client = new ReportClient()
    const get = jest.spyOn((client as any).http.connection, 'get')
      .mockResolvedValue({ data: { payload: { horizon: 60 } } } as any)

    const res = await client.cashFlow({ horizon: 60 }, { env: 'staging', authorization: 'Bearer t' } as any)

    expect(get).toHaveBeenCalledWith('/cash-flow', expect.objectContaining({ params: { horizon: 60 } }))
    expect(res.payload).toEqual({ horizon: 60 })
  })
})
```

Em `client-shape.spec.ts`, acrescente dentro do `describe`:

```ts
  it('ReportClient: só os relatórios; sem CRUD genérico', () => {
    const c = new ReportClient() as any
    expect(typeof c.cashFlow).toBe('function')
    expect(c.insert).toBeUndefined()
    expect(c.findAll).toBeUndefined()
  })
```

(e `import { ReportClient } from './report-client'` no topo).

- [ ] **Passo 2: Ver falhar**

Run: `npx jest src/clients`
Expected: FAIL — `Cannot find module './report-client'`.

- [ ] **Passo 3: Tipos do contrato**

Crie `src/core/data/reports/cash-flow-response.ts`:

```ts
import type { MovementDirection, MovementStatus } from '../financial/financial-movement-schema'

/**
 * Contrato de GET /reports/cash-flow (fatia 2, MIN-94). Número cru e data
 * `AAAA-MM-DD` no fuso America/Sao_Paulo — formatação é do front (D6).
 * Spec: MintlyApi/specs/modulos-novos/20261012/fluxo-de-caixa.md.
 */

/** Query: horizonte em dias, 1 a 365. Padrão 30 no servidor. */
export interface CashFlowQuery {
  horizon?: number
}

/** Um dia da série: saldo no FIM do dia e o que entrou/saiu nele. */
export interface DailyPoint {
  date: string
  balance: number
  inflows: number
  outflows: number
}

/** Bloco de 7 dias a partir de hoje (o último pode ser menor). */
export interface CashFlowWeek {
  from: string
  to: string
  inflows: number
  outflows: number
}

/** Movimentação COM vencimento na janela do relatório. */
export interface DueItem {
  id: string
  title: string
  category: { _id: string; name: string }
  direction: MovementDirection
  /** Entrada: netValue; saída: grossValue — a mesma regra do saldo. */
  amount: number
  dueDate: string
  status: MovementStatus.Pending | MovementStatus.Settled
  /** Pendente com vencimento antes de hoje. */
  overdue: boolean
  /** Só em liquidada: quando o dinheiro mexeu. */
  settledAt?: string
}

/** Primeiro dia da projeção com saldo abaixo da margem de segurança. */
export interface CriticalDayInsight {
  kind: 'criticalDay'
  severity: 'warning'
  date: string
  balance: number
  threshold: number
}

/** Blocos determinísticos (design 1.4). Novos tipos entram nesta união. */
export type CashFlowInsight = CriticalDayInsight

export interface CashFlowReport {
  horizon: number
  today: string
  /** Σ availableBalance das contas ativas. */
  cashToday: number
  /** Entradas pendentes até o fim do horizonte, vencidas incluídas. */
  receivable: number
  /** Saídas pendentes até o fim do horizonte, vencidas incluídas. */
  payable: number
  /** cashToday + receivable − payable = saldo do último ponto da projeção. */
  projectedBalance: number
  lowestBalance: { date: string; balance: number }
  overdue: { count: number; receivable: number; payable: number }
  safetyThreshold: { value: number; days: number; avgDailyOutflow: number }
  /** Hoje até hoje + horizon (horizon + 1 pontos). */
  projection: DailyPoint[]
  /** Os 7 dias anteriores a hoje, do mais antigo para o mais recente. */
  realized: DailyPoint[]
  weeks: CashFlowWeek[]
  dueItems: DueItem[]
  insights: CashFlowInsight[]
}
```

Crie `src/core/data/reports/index.ts`:

```ts
export * from './cash-flow-response'
```

Em `src/core/data/index.ts`, acrescente `export * from './reports'`.

- [ ] **Passo 4: Client**

Crie `src/clients/report-client.ts`:

```ts
import { ResponseDto, withHeaders } from '../core'
import { HttpBaseClient } from '../core/client/http-base-client'
import type { Headers } from '../core/data/request/headers'
import type { CashFlowQuery, CashFlowReport } from '../core/data/reports/cash-flow-response'

/**
 * Relatórios de leitura (módulos novos). Só GETs próprios — compõe o
 * HttpBaseClient pela conexão, como o FinancialMovementClient. As próximas
 * fatias (result, expenses) entram aqui como métodos.
 */
export class ReportClient {
  private readonly http = new HttpBaseClient<CashFlowReport>('reports')

  /** Fluxo de Caixa: caixa hoje, projeção no horizonte, vencimentos e dia crítico. */
  async cashFlow (query: CashFlowQuery, headers: Headers): Promise<ResponseDto<CashFlowReport>> {
    const response = await this.http.connection.get<ResponseDto<CashFlowReport>>('/cash-flow', withHeaders(headers, { params: query }))
    return response.data
  }
}
```

Em `src/clients/index.ts`: `export { ReportClient } from './report-client'`.

Em `master-client.ts`: importe `ReportClient` junto dos outros, declare
`reportClient: ReportClient` e, no construtor, `this.reportClient = new ReportClient()`.

- [ ] **Passo 5: Ver passar + checagens + build**

Run: `npx jest && npm run typecheck && npm run lint && npm run build`
Expected: tudo verde; `build/core/data/reports/cash-flow-response.d.ts` existe.

- [ ] **Passo 6: Commit e push**

```bash
git add src/core/data/reports src/core/data/index.ts src/clients/report-client.ts src/clients/report-client.spec.ts src/clients/index.ts src/clients/client-shape.spec.ts src/core/client/master-client.ts
git commit -m "feat(reports): contrato e client do Fluxo de Caixa"
git push -u origin feat/20261012/fluxo-de-caixa
```

O PR da lib é aberto na Tarefa 12, depois que a API provar o contrato.

---

## Tarefa 3 — MintlyApi: consumir a lib local e `resolveSettledAt`

**Repositório:** MintlyApi · **Branch:** `feat/20261012/fluxo-de-caixa` (já existe)

**Files:**
- Modify: `src/app/financial-movement/movement-rules.ts`
- Test: `src/app/financial-movement/movement-rules.spec.ts`

**Interfaces:**
- Produces: `resolveSettledAt(params: { newStatus: MovementStatus | string; previousStatus?: MovementStatus | string; previousSettledAt?: Date; informed?: Date; fallback: Date }): Date | undefined`.

- [ ] **Passo 1: Build local da lib dentro da API**

Até a lib ser publicada, a API usa o build local (mesmo procedimento da fatia 1):

```bash
cd ../MintlyLib && npm run build && cd ../MintlyApi
rm -rf node_modules/mintly-lib/build && cp -r ../MintlyLib/build node_modules/mintly-lib/build
node -e "console.log(Object.keys(require('mintly-lib')).filter(k => k === 'ReportClient'))"
```

Expected: `[ 'ReportClient' ]`. Nada disso é commitado — o `package.json` muda só na Tarefa 12.

- [ ] **Passo 2: Testes que falham**

Em `movement-rules.spec.ts` (importe `resolveSettledAt` junto dos demais):

```ts
describe('resolveSettledAt (fatia 2)', () => {
  const date = new Date('2026-10-01T15:00:00.000Z')
  const now = new Date('2026-10-12T15:00:00.000Z')

  it('pendente não tem settledAt', () => {
    expect(resolveSettledAt({ newStatus: MovementStatus.Pending, fallback: now })).toBeUndefined()
  })

  it('cancelada não tem settledAt', () => {
    expect(resolveSettledAt({ newStatus: MovementStatus.Cancelled, previousStatus: MovementStatus.Settled, previousSettledAt: date, fallback: now })).toBeUndefined()
  })

  it('registro à vista: usa o fallback (data do lançamento)', () => {
    expect(resolveSettledAt({ newStatus: MovementStatus.Settled, fallback: date })).toEqual(date)
  })

  it('pendente → liquidada sem data informada: usa o fallback', () => {
    expect(resolveSettledAt({ newStatus: MovementStatus.Settled, previousStatus: MovementStatus.Pending, fallback: now })).toEqual(now)
  })

  it('data informada vence o fallback', () => {
    const informed = new Date('2026-10-09T12:00:00.000Z')
    expect(resolveSettledAt({ newStatus: MovementStatus.Settled, previousStatus: MovementStatus.Pending, informed, fallback: now })).toEqual(informed)
  })

  it('continua liquidada: preserva o settledAt anterior', () => {
    expect(resolveSettledAt({ newStatus: MovementStatus.Settled, previousStatus: MovementStatus.Settled, previousSettledAt: date, fallback: now })).toEqual(date)
  })

  it('continua liquidada sem settledAt anterior (documento antigo): não inventa um', () => {
    expect(resolveSettledAt({ newStatus: MovementStatus.Settled, previousStatus: MovementStatus.Settled, fallback: now })).toBeUndefined()
  })
})
```

- [ ] **Passo 3: Ver falhar**

Run: `npx vitest run src/app/financial-movement/movement-rules.spec.ts`
Expected: FAIL — `resolveSettledAt is not a function`.

- [ ] **Passo 4: Implementar**

Em `movement-rules.ts`, depois de `shouldRecomputeStatus`:

```ts
/**
 * `settledAt` do documento resultante — quando o dinheiro de fato mexeu.
 * Fonte única da regra; quem chama escolhe só o `fallback`:
 *
 *  - registro à vista e recompute por troca de conta → `date` (o dinheiro
 *    mexeu na data do lançamento, não na hora do cadastro);
 *  - liquidação automática → `dueDate` (o repasse cai na data, mesmo que o
 *    robô rode às 3h do dia seguinte);
 *  - dono no PATCH de status → agora, ou o `informed` do body.
 *
 * Quem continua liquidada preserva o que tinha — inclusive "nada", em documento
 * anterior ao campo: inventar uma data ali mudaria o passado do relatório.
 * Pendente e cancelada não têm `settledAt`.
 */
export function resolveSettledAt (params: {
  newStatus: MovementStatus | string
  previousStatus?: MovementStatus | string
  previousSettledAt?: Date
  informed?: Date
  fallback: Date
}): Date | undefined {
  const { newStatus, previousStatus, previousSettledAt, informed, fallback } = params

  if (newStatus !== MovementStatus.Settled) return undefined
  if (previousStatus === MovementStatus.Settled) return previousSettledAt
  return informed ?? fallback
}
```

- [ ] **Passo 5: Ver passar**

Run: `npx vitest run src/app/financial-movement/movement-rules.spec.ts`
Expected: PASS.

- [ ] **Passo 6: Commit**

```bash
git add src/app/financial-movement/movement-rules.ts src/app/financial-movement/movement-rules.spec.ts
git commit -m "feat(movimento): regra pura do settledAt"
```

---

## Tarefa 4 — MintlyApi: gravar `settledAt` em todas as transições

**Files:**
- Create: `src/core/errors/core/validation-error.ts`
- Modify: `src/core/errors/core/error-glossary.ts`
- Modify: `src/app/financial-movement/movement-status.ts`
- Modify: `src/app/financial-movement/use-cases/settle-due-movements.use-case.ts`
- Modify: `src/app/financial-movement/use-cases/register-movement.use-case.ts`
- Modify: `src/app/financial-movement/use-cases/update-movement.use-case.ts`
- Modify: `src/app/financial-movement/use-cases/change-movement-status.use-case.ts`
- Modify: `src/app/financial-movement/financial-movement-controller.ts` (`changeStatus`)
- Test: `src/app/financial-movement/use-cases/settled-at.int.spec.ts` (novo)

**Interfaces:**
- Consumes: `resolveSettledAt` (Tarefa 3).
- Produces: `applyStatusTransition(p)` aceita `settledAt?: Date` e devolve `Promise<{ settledAt?: Date }>`; `ChangeMovementStatusUseCase.execute(movementId, newStatus, ctx, options?: { settledAt?: string | Date })`; `parseSettledAt(value, now): Date | undefined`; `ValidationError` (400, `APP-0005`).

- [ ] **Passo 1: Testes de integração que falham**

Crie `src/app/financial-movement/use-cases/settled-at.int.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../../financial-account/financial-account-repository'
import { FinancialMovementRepository } from '../financial-movement-repository'
import { SettleDueMovementsUseCase } from './settle-due-movements.use-case'

const DAY = 24 * 60 * 60 * 1000
let envCounter = 0
const freshEnv = () => `int_settled_${++envCounter}`

describe('settledAt — quando o dinheiro mexeu (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  async function setup () {
    const env = freshEnv()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: {
        person: { name: 'Dono Settled', phone: '11977777777' },
        password: 'Senha123',
        restaurantName: 'Restaurante Settled',
        termsAccepted: true,
        email: `dono_${env}@teste.com`,
      },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId

    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })

    const db = mongoConnection.getDatabase(env)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const category = (type: 'revenue' | 'expense', name: string) => db.collection('financial_categories').insertOne({
      restaurantId, name, type, behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit,
    })
    const revenue = await category('revenue', 'Vendas')
    const expense = await category('expense', 'Fornecedores')
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })

    return { auth, env, restaurantId, db, cashId: String(cash!._id), revenueCatId: String(revenue.insertedId), expenseCatId: String(expense.insertedId) }
  }

  const register = (auth: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: { paymentMethod: 'pix', confirmDuplicate: true, ...payload } })

  const stored = async (db: any, id: string) => db.collection('financial_movements').findOne({ _id: new ObjectId(id) })

  it('registro à vista nasce com settledAt = date', async () => {
    const s = await setup()
    const date = new Date(Date.now() - 3 * DAY)
    const res = await register(s.auth, { direction: 'out', title: 'Gás', grossValue: 100, date: date.toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    expect(res.statusCode).toBe(201)

    const doc = await stored(s.db, res.json().payload._id)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt.toISOString()).toBe(date.toISOString())
  })

  it('registro com vencimento nasce pendente e sem settledAt', async () => {
    const s = await setup()
    const res = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 100, date: new Date().toISOString(), dueDate: new Date(Date.now() + 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })

    const doc = await stored(s.db, res.json().payload._id)
    expect(doc.status).toBe('pending')
    expect(doc.settledAt).toBeUndefined()
  })

  it('PATCH status com settledAt informado grava a data informada', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto atrasado', grossValue: 200, date: new Date(Date.now() - 10 * DAY).toISOString(), dueDate: new Date(Date.now() - 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const paidAt = new Date(Date.now() - 3 * DAY).toISOString()

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: paidAt } })

    expect(res.statusCode).toBe(200)
    expect(new Date(res.json().payload.settledAt).toISOString()).toBe(paidAt)
    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(paidAt)
  })

  it('PATCH status sem settledAt grava agora', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const before = Date.now()

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled' } })

    const settledAt = (await stored(s.db, id)).settledAt.getTime()
    expect(settledAt).toBeGreaterThanOrEqual(before)
    expect(settledAt).toBeLessThanOrEqual(Date.now())
  })

  it('PATCH status aceita relógio do cliente até 5 minutos adiantado', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${created.json().payload._id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: new Date(Date.now() + 60 * 1000).toISOString() } })

    expect(res.statusCode).toBe(200)
  })

  it('PATCH status recusa settledAt no futuro e data inválida', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    const future = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: new Date(Date.now() + DAY).toISOString() } })
    const garbage = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: 'ontem' } })

    expect(future.statusCode).toBe(400)
    expect(future.json().code).toBe('APP-0005')
    expect(garbage.statusCode).toBe(400)
    expect((await stored(s.db, id)).status).toBe('pending')
  })

  it('voltar para pendente remove o settledAt', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Gás', grossValue: 100, date: new Date().toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'pending' } })

    expect((await stored(s.db, id)).settledAt).toBeUndefined()
  })

  it('liquidação automática grava settledAt = dueDate', async () => {
    const s = await setup()
    const platform = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: s.auth,
      payload: { restaurantId: s.restaurantId, name: 'iFood', type: 'platform', status: 'active', feePercent: 10, settlementDays: 30, audit: { createdAt: new Date(), updatedAt: new Date() } },
    })
    const created = await register(s.auth, { direction: 'in', title: 'Pedido', grossValue: 100, date: new Date(Date.now() - 40 * DAY).toISOString(), accountId: platform.json().payload._id, categoryId: s.revenueCatId })
    const id = created.json().payload._id
    const dueDate = (await stored(s.db, id)).dueDate

    await new SettleDueMovementsUseCase().execute({ env: s.env })

    const doc = await stored(s.db, id)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt.toISOString()).toBe(dueDate.toISOString())
  })

  it('edição que remove o vencimento liquida com settledAt = date', async () => {
    const s = await setup()
    const date = new Date(Date.now() - 2 * DAY)
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 100, date: date.toISOString(), dueDate: new Date(Date.now() + 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: { dueDate: null } })

    expect(res.statusCode).toBe(200)
    const doc = await stored(s.db, id)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt.toISOString()).toBe(date.toISOString())
  })

  it('edição de campo inócuo em liquidada preserva o settledAt', async () => {
    const s = await setup()
    const date = new Date(Date.now() - 2 * DAY)
    const created = await register(s.auth, { direction: 'out', title: 'Gás', grossValue: 100, date: date.toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: { title: 'Gás de cozinha' } })

    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(date.toISOString())
  })
})
```

- [ ] **Passo 2: Ver falhar**

Run: `npx vitest run src/app/financial-movement/use-cases/settled-at.int.spec.ts`
Expected: FAIL — `settledAt` ausente em todos os casos que o esperam; o de data futura devolve 200.

- [ ] **Passo 3: `ValidationError`**

Em `error-glossary.ts`, depois de `invalidEnv`:

```ts
  validation: {
    message: 'Dados inválidos.',
    apiMessage: 'The request data is invalid.',
    code: 'APP-0005',
  },
```

Crie `src/core/errors/core/validation-error.ts`:

```ts
import { BaseError } from './base-error'
import { errorGlossary } from './error-glossary'

/**
 * 400 de regra de negócio sobre o dado enviado (o que o schema não expressa —
 * ex.: data no futuro). Validação de FORMA continua no schema (Sapphire/Fastify).
 */
export class ValidationError extends BaseError {
  constructor (message: string) {
    super(message, message, errorGlossary.validation.code, 400)
  }
}
```

- [ ] **Passo 4: `applyStatusTransition` grava e remove**

Em `movement-status.ts`: importe `resolveSettledAt` de `./movement-rules`; acrescente
em `StatusTransitionParams`:

```ts
  /** Quando o dinheiro mexeu, se quem chama sabe (settler: dueDate; dono: o informado). Ausente = `now`. */
  settledAt?: Date
```

Troque a assinatura e o `updateOne`:

```ts
export async function applyStatusTransition (p: StatusTransitionParams): Promise<{ settledAt?: Date }> {
  const { movements, accounts, movement, newStatus, actor, statusSource, session, now } = p

  const oldStatus = String(movement.status)
  const restaurantId = movement.restaurantId as string | undefined

  const settledAt = resolveSettledAt({
    newStatus,
    previousStatus: oldStatus,
    previousSettledAt: movement.settledAt ?? undefined,
    informed: p.settledAt,
    fallback: now,
  })

  const update: Record<string, any> = {
    $set: {
      status: newStatus,
      statusSource,
      'audit.updatedAt': now,
      'audit.updatedBy': actor,
    },
    $push: {
      history: { at: now, by: actor, action: `status:${oldStatus}->${newStatus}` },
    },
  }
  // Pendente/cancelada não têm settledAt: a volta remove o campo, senão a série
  // realizada contaria dinheiro que não mexeu.
  if (settledAt != null) update.$set.settledAt = settledAt
  else update.$unset = { settledAt: '' }

  const res = await movements.updateOne({ _id: movement._id, restaurantId, status: oldStatus }, update, { session })
```

E no fim da função, depois dos dois `applyBalanceImpact`: `return { settledAt }`.

- [ ] **Passo 5: Settler passa o vencimento**

Em `settle-due-movements.use-case.ts`, na chamada de `applyStatusTransition`,
acrescente `settledAt: movement.dueDate,` com o comentário:

```ts
            // O repasse cai NA DATA, mesmo que o robô só rode às 3h do dia seguinte.
            settledAt: movement.dueDate,
```

- [ ] **Passo 6: Registro**

Em `register-movement.use-case.ts`: importe `resolveSettledAt` junto de
`computeSnapshot, defaultStatus, ...`. Depois de `if (dueDate != null) doc.dueDate = dueDate`:

```ts
        // À vista: o dinheiro mexeu na data do lançamento, não na hora do cadastro.
        const settledAt = resolveSettledAt({ newStatus: status, fallback: date })
        if (settledAt != null) doc.settledAt = settledAt
```

- [ ] **Passo 7: Edição**

Em `update-movement.use-case.ts`: importe `resolveSettledAt`. Depois de
`if (newDueDate != null) newDoc.dueDate = newDueDate`:

```ts
        // Mudança explícita de status é ação humana (agora); recompute pela regra
        // segue o lançamento (newDate). Quem continua liquidada preserva o que tinha.
        const settledAt = resolveSettledAt({
          newStatus,
          previousStatus: mov.status,
          previousSettledAt: mov.settledAt != null ? new Date(mov.settledAt) : undefined,
          fallback: statusExplicitlyChanged ? now : newDate,
        })
        if (settledAt != null) newDoc.settledAt = settledAt
```

(O `replaceOne` já descarta o campo quando ele não está no `newDoc`.)

- [ ] **Passo 8: PATCH de status aceita `settledAt`**

Em `change-movement-status.use-case.ts`, importe `ValidationError` e acrescente, acima da classe:

```ts
/** Relógio do cliente adiantado não pode virar 400 ao mandar "agora". */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

/**
 * `settledAt` informado pelo dono no PATCH de status. Ausente → `undefined`
 * (a transição usa agora). Inválido ou no futuro → 400: pagamento que ainda não
 * aconteceu não é liquidação.
 */
export function parseSettledAt (value: string | Date | undefined, now: Date): Date | undefined {
  if (value == null) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('settledAt inválido: informe uma data ISO.')
  }
  if (parsed.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new ValidationError('settledAt não pode estar no futuro.')
  }
  return parsed
}
```

Troque a assinatura de `execute` e use o valor:

```ts
  async execute (movementId: string, newStatus: string, ctx: RequestContext, options: { settledAt?: string | Date } = {}): Promise<any> {
    if (!VALID.has(newStatus)) {
      throw new ConflictError(`Status inválido: ${newStatus}.`)
    }
    const informedSettledAt = parseSettledAt(options.settledAt, new Date())
```

e no ramo da transição:

```ts
        const transition = await applyStatusTransition({
          movements,
          accounts,
          movement: mov,
          newStatus,
          actor: ctx.userId ?? 'system',
          statusSource: MovementStatusSource.Manual,
          session,
          now: new Date(),
          settledAt: informedSettledAt,
        })

        updated = movementFromStorage({
          ...mov,
          status: newStatus,
          statusSource: MovementStatusSource.Manual,
          settledAt: transition.settledAt,
        } as any)
```

Em `financial-movement-controller.ts`, `changeStatus`:

```ts
    const { status, settledAt } = (request.body ?? {}) as { status: string; settledAt?: string }
    const result = await this.changeStatusUseCase.execute(id, status, ctx, { settledAt })
```

Atualize o comentário da rota em `financial-movement-routes.ts`:
`// PATCH /financial-movements/:id/status — muda status (corrige saldo). body: { status, settledAt? }`.

- [ ] **Passo 9: Ver passar**

Run: `npx vitest run src/app/financial-movement`
Expected: PASS, inclusive os testes antigos de status, settler e edição. Se algum
unitário antigo que mocka `applyStatusTransition`/`updateOne` quebrar por causa do
`$unset`, ajuste a asserção para o novo formato do update — não a regra.

- [ ] **Passo 10: Commit**

```bash
git add src/core/errors src/app/financial-movement
git commit -m "feat(movimento): grava settledAt no registro, edicao, PATCH de status e settler"
```

---

## Tarefa 5 — Helpers de dia local

**Files:**
- Create: `src/app/reports/shared/period.ts`
- Test: `src/app/reports/shared/period.spec.ts`

**Interfaces:**
- Produces: `REPORT_TIME_ZONE`, `toLocalDay(instant: Date): string`, `addDaysToDay(day: string, n: number): string`, `diffDays(from: string, to: string): number`, `startOfLocalDay(day: string): Date`.

- [ ] **Passo 1: Testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { addDaysToDay, diffDays, startOfLocalDay, toLocalDay } from './period'

describe('period — dias em America/Sao_Paulo', () => {
  it('lançamento às 22h30 em São Paulo (01h30 UTC do dia seguinte) fica no próprio dia', () => {
    expect(toLocalDay(new Date('2026-10-13T01:30:00.000Z'))).toBe('2026-10-12')
  })

  it('meia-noite em São Paulo já é o dia seguinte', () => {
    expect(toLocalDay(new Date('2026-10-13T03:00:00.000Z'))).toBe('2026-10-13')
  })

  it('soma dias atravessando mês e ano', () => {
    expect(addDaysToDay('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysToDay('2026-01-02', -5)).toBe('2025-12-28')
  })

  it('diferença em dias corridos', () => {
    expect(diffDays('2026-10-01', '2026-10-12')).toBe(11)
    expect(diffDays('2026-10-12', '2026-10-12')).toBe(0)
  })

  it('início do dia local é 03h UTC', () => {
    expect(startOfLocalDay('2026-10-12').toISOString()).toBe('2026-10-12T03:00:00.000Z')
  })

  it('início do dia é o inverso de toLocalDay', () => {
    expect(toLocalDay(startOfLocalDay('2026-02-28'))).toBe('2026-02-28')
  })
})
```

- [ ] **Passo 2: Ver falhar**

Run: `npx vitest run src/app/reports/shared/period.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Passo 3: Implementar**

```ts
/**
 * Dias dos relatórios (design 1.3): "hoje" só significa algo com fuso definido.
 * Em UTC, um lançamento das 22h de 31 de julho cairia em agosto. O fuso é fixo
 * em America/Sao_Paulo (N11 registra o fuso por restaurante como pendência).
 *
 * Um "dia" aqui é a string `AAAA-MM-DD`. Aritmética de dias é feita sobre a
 * string (via UTC, que não tem horário de verão), nunca sobre o instante.
 */
export const REPORT_TIME_ZONE = 'America/Sao_Paulo'

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TIME_ZONE,
  timeZoneName: 'longOffset',
})

const DAY_MS = 24 * 60 * 60 * 1000

function parts (day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}

/** Instante → dia local (`en-CA` formata como AAAA-MM-DD). */
export function toLocalDay (instant: Date): string {
  return dayFormat.format(instant)
}

export function addDaysToDay (day: string, n: number): string {
  const [y, m, d] = parts(day)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function diffDays (from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

/** Deslocamento do fuso naquele dia, em minutos (ex.: GMT-03:00 → -180). */
function offsetMinutes (day: string): number {
  const [y, m, d] = parts(day)
  const name = offsetFormat.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** Primeiro instante do dia local — limite inferior de filtro no Mongo. */
export function startOfLocalDay (day: string): Date {
  const [y, m, d] = parts(day)
  return new Date(Date.UTC(y, m - 1, d) - offsetMinutes(day) * 60 * 1000)
}
```

- [ ] **Passo 4: Ver passar**

Run: `npx vitest run src/app/reports/shared/period.spec.ts`
Expected: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/app/reports/shared/period.ts src/app/reports/shared/period.spec.ts
git commit -m "feat(reports): dias locais em America/Sao_Paulo"
```

---

## Tarefa 6 — Data de caixa

**Files:**
- Create: `src/app/reports/shared/cash-date.ts`
- Test: `src/app/reports/shared/cash-date.spec.ts`

**Interfaces:**
- Consumes: `toLocalDay` (Tarefa 5).
- Produces:

```ts
export interface CashFlowMovement {
  id: string
  title: string
  category: { _id: string; name: string }
  direction: MovementDirection
  status: MovementStatus
  date: Date
  dueDate?: Date
  settledAt?: Date
  grossValue: number
  netValue: number
}
export function cashDay (m: CashFlowMovement, today: string): string
export function cashAmount (m: CashFlowMovement): number
export function isOverdue (m: CashFlowMovement, today: string): boolean
```

- [ ] **Passo 1: Testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { CashFlowMovement, cashAmount, cashDay, isOverdue } from './cash-date'

const TODAY = '2026-10-12'
// 15h UTC = 12h em São Paulo: longe da virada do dia.
const at = (day: string) => new Date(`${day}T15:00:00.000Z`)

function mov (over: Partial<CashFlowMovement> = {}): CashFlowMovement {
  return {
    id: 'm1',
    title: 'Boleto',
    category: { _id: 'c1', name: 'Fornecedores' },
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    date: at('2026-10-01'),
    grossValue: 100,
    netValue: 100,
    ...over,
  }
}

describe('cashDay', () => {
  it('pendente com vencimento futuro: o dia do vencimento', () => {
    expect(cashDay(mov({ dueDate: at('2026-10-20') }), TODAY)).toBe('2026-10-20')
  })

  it('pendente vencida: conta hoje', () => {
    expect(cashDay(mov({ dueDate: at('2026-10-03') }), TODAY)).toBe(TODAY)
  })

  it('pendente sem vencimento (dono forçou): a data do lançamento, ou hoje se passou', () => {
    expect(cashDay(mov({ date: at('2026-10-15') }), TODAY)).toBe('2026-10-15')
    expect(cashDay(mov({ date: at('2026-10-01') }), TODAY)).toBe(TODAY)
  })

  it('liquidada: settledAt vence dueDate e date', () => {
    expect(cashDay(mov({ status: MovementStatus.Settled, dueDate: at('2026-10-05'), settledAt: at('2026-10-08') }), TODAY)).toBe('2026-10-08')
  })

  it('liquidada sem settledAt (documento antigo): dueDate, senão date — sem puxar para hoje', () => {
    expect(cashDay(mov({ status: MovementStatus.Settled, dueDate: at('2026-10-05') }), TODAY)).toBe('2026-10-05')
    expect(cashDay(mov({ status: MovementStatus.Settled }), TODAY)).toBe('2026-10-01')
  })

  it('vencimento às 22h30 em São Paulo fica no próprio dia', () => {
    expect(cashDay(mov({ dueDate: new Date('2026-10-21T01:30:00.000Z') }), TODAY)).toBe('2026-10-20')
  })
})

describe('cashAmount', () => {
  it('entrada vale o líquido; saída vale o bruto', () => {
    expect(cashAmount(mov({ direction: MovementDirection.In, grossValue: 100, netValue: 88 }))).toBe(88)
    expect(cashAmount(mov({ direction: MovementDirection.Out, grossValue: 100, netValue: 100 }))).toBe(100)
  })
})

describe('isOverdue', () => {
  it('pendente com vencimento antes de hoje', () => {
    expect(isOverdue(mov({ dueDate: at('2026-10-11') }), TODAY)).toBe(true)
  })

  it('vence hoje não está vencida', () => {
    expect(isOverdue(mov({ dueDate: at(TODAY) }), TODAY)).toBe(false)
  })

  it('liquidada nunca está vencida; sem vencimento também não', () => {
    expect(isOverdue(mov({ status: MovementStatus.Settled, dueDate: at('2026-10-01') }), TODAY)).toBe(false)
    expect(isOverdue(mov({ date: at('2026-10-01') }), TODAY)).toBe(false)
  })
})
```

- [ ] **Passo 2: Ver falhar**

Run: `npx vitest run src/app/reports/shared/cash-date.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Passo 3: Implementar**

```ts
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { toLocalDay } from './period'

/**
 * O que os relatórios de caixa precisam de uma movimentação — dinheiro já em
 * `number` (o repositório converte o Decimal128).
 */
export interface CashFlowMovement {
  id: string
  title: string
  category: { _id: string; name: string }
  direction: MovementDirection
  status: MovementStatus
  date: Date
  dueDate?: Date
  settledAt?: Date
  grossValue: number
  netValue: number
}

/**
 * Data de caixa: o dia em que a movimentação conta no Fluxo de Caixa (spec,
 * "Data de caixa"). Pendente vencida conta HOJE (F1): o dinheiro ainda vai
 * mexer, só não se sabe quando. Liquidada conta no dia em que mexeu; documento
 * anterior ao `settledAt` cai em `dueDate ?? date`, que é o que o settler teria
 * gravado.
 */
export function cashDay (m: CashFlowMovement, today: string): string {
  if (m.status === MovementStatus.Settled) {
    return toLocalDay(m.settledAt ?? m.dueDate ?? m.date)
  }
  const day = toLocalDay(m.dueDate ?? m.date)
  return day < today ? today : day
}

/** Mesma regra do saldo (`balanceImpact`): entrada vale o líquido, saída o bruto. */
export function cashAmount (m: CashFlowMovement): number {
  return m.direction === MovementDirection.In ? m.netValue : m.grossValue
}

/** Vencida = pendente COM vencimento antes de hoje. Vencer hoje ainda não é atraso. */
export function isOverdue (m: CashFlowMovement, today: string): boolean {
  return m.status === MovementStatus.Pending && m.dueDate != null && toLocalDay(m.dueDate) < today
}
```

- [ ] **Passo 4: Ver passar**

Run: `npx vitest run src/app/reports/shared/cash-date.spec.ts`
Expected: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/app/reports/shared/cash-date.ts src/app/reports/shared/cash-date.spec.ts
git commit -m "feat(reports): data de caixa de uma movimentacao"
```

---

## Tarefa 7 — Métricas: projeção, totais, menor saldo e semanas

**Files:**
- Create: `src/app/reports/cash-flow/cash-flow-metrics.ts`
- Test: `src/app/reports/cash-flow/cash-flow-metrics.spec.ts`

**Interfaces:**
- Consumes: `CashFlowMovement`, `cashDay`, `cashAmount`, `isOverdue` (Tarefa 6); `addDaysToDay` (Tarefa 5); `DailyPoint`, `CashFlowWeek` (lib).
- Produces: constantes `SAFETY_DAYS`, `REALIZED_DAYS`, `OUTFLOW_HISTORY_DAYS`, `WEEK_DAYS`; `buildProjection(p: { today: string; horizon: number; cashToday: number; movements: CashFlowMovement[] }): DailyPoint[]`; `summarizePending(movements, today, horizon): { receivable: number; payable: number; overdue: { count: number; receivable: number; payable: number } }`; `lowestPoint(points: DailyPoint[]): { date: string; balance: number }`; `groupWeeks(points: DailyPoint[]): CashFlowWeek[]`.

- [ ] **Passo 1: Testes que falham**

Crie `cash-flow-metrics.spec.ts` (as Tarefas 8 e 9 acrescentam `describe`s no mesmo arquivo):

```ts
import { describe, expect, it } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { CashFlowMovement } from '../shared/cash-date'
import { buildProjection, groupWeeks, lowestPoint, summarizePending } from './cash-flow-metrics'

const TODAY = '2026-10-12'
const at = (day: string) => new Date(`${day}T15:00:00.000Z`)

let seq = 0
function mov (over: Partial<CashFlowMovement> = {}): CashFlowMovement {
  return {
    id: `m${++seq}`,
    title: `Mov ${seq}`,
    category: { _id: 'c1', name: 'Categoria' },
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    date: at('2026-10-01'),
    grossValue: 100,
    netValue: 100,
    ...over,
  }
}

describe('buildProjection', () => {
  it('um ponto por dia, de hoje até hoje + horizonte', () => {
    const points = buildProjection({ today: TODAY, horizon: 3, cashToday: 1000, movements: [] })
    expect(points.map((p) => p.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'])
    expect(points.every((p) => p.balance === 1000)).toBe(true)
  })

  it('acumula entradas (líquido) e saídas (bruto) dia a dia', () => {
    const points = buildProjection({
      today: TODAY,
      horizon: 3,
      cashToday: 1000,
      movements: [
        mov({ direction: MovementDirection.In, grossValue: 500, netValue: 440, dueDate: at('2026-10-13') }),
        mov({ direction: MovementDirection.Out, grossValue: 300, dueDate: at('2026-10-14') }),
      ],
    })
    expect(points.map((p) => p.balance)).toEqual([1000, 1440, 1140, 1140])
    expect(points[1]).toMatchObject({ inflows: 440, outflows: 0 })
    expect(points[2]).toMatchObject({ inflows: 0, outflows: 300 })
  })

  it('vencidas entram hoje', () => {
    const points = buildProjection({ today: TODAY, horizon: 1, cashToday: 1000, movements: [mov({ grossValue: 250, dueDate: at('2026-10-02') })] })
    expect(points[0]).toMatchObject({ balance: 750, outflows: 250 })
  })

  it('ignora liquidadas, canceladas e o que vence depois do horizonte', () => {
    const points = buildProjection({
      today: TODAY,
      horizon: 2,
      cashToday: 1000,
      movements: [
        mov({ status: MovementStatus.Settled, dueDate: at('2026-10-13') }),
        mov({ status: MovementStatus.Cancelled, dueDate: at('2026-10-13') }),
        mov({ dueDate: at('2026-10-30') }),
      ],
    })
    expect(points.map((p) => p.balance)).toEqual([1000, 1000, 1000])
  })

  it('soma em centavos: 0,1 + 0,2 não vira 0,30000000000000004', () => {
    const points = buildProjection({
      today: TODAY,
      horizon: 0,
      cashToday: 0,
      movements: [
        mov({ direction: MovementDirection.In, grossValue: 0.1, netValue: 0.1, dueDate: at(TODAY) }),
        mov({ direction: MovementDirection.In, grossValue: 0.2, netValue: 0.2, dueDate: at(TODAY) }),
      ],
    })
    expect(points[0].balance).toBe(0.3)
  })
})

describe('summarizePending', () => {
  it('a receber e a pagar no horizonte, vencidas incluídas; vencidas também em overdue', () => {
    const summary = summarizePending([
      mov({ direction: MovementDirection.In, grossValue: 500, netValue: 450, dueDate: at('2026-10-20') }),
      mov({ direction: MovementDirection.Out, grossValue: 300, dueDate: at('2026-10-05') }),
      mov({ direction: MovementDirection.In, grossValue: 80, netValue: 80, dueDate: at('2026-10-10') }),
      mov({ direction: MovementDirection.Out, grossValue: 999, dueDate: at('2026-12-01') }),
      mov({ status: MovementStatus.Cancelled, grossValue: 999, dueDate: at('2026-10-13') }),
      mov({ status: MovementStatus.Settled, grossValue: 999, dueDate: at('2026-10-13') }),
    ], TODAY, 30)

    expect(summary).toEqual({ receivable: 530, payable: 300, overdue: { count: 2, receivable: 80, payable: 300 } })
  })

  it('sem movimentações: tudo zero', () => {
    expect(summarizePending([], TODAY, 30)).toEqual({ receivable: 0, payable: 0, overdue: { count: 0, receivable: 0, payable: 0 } })
  })
})

describe('lowestPoint', () => {
  it('menor saldo; empate fica com o primeiro dia', () => {
    const points = [
      { date: 'a', balance: 10, inflows: 0, outflows: 0 },
      { date: 'b', balance: 5, inflows: 0, outflows: 0 },
      { date: 'c', balance: 5, inflows: 0, outflows: 0 },
    ]
    expect(lowestPoint(points)).toEqual({ date: 'b', balance: 5 })
  })
})

describe('groupWeeks', () => {
  it('blocos de 7 dias a partir de hoje; o último pode ser menor', () => {
    const points = buildProjection({ today: TODAY, horizon: 30, cashToday: 0, movements: [mov({ grossValue: 100, dueDate: at('2026-10-05') }), mov({ grossValue: 40, dueDate: at('2026-10-19') })] })

    const weeks = groupWeeks(points)

    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual({ from: '2026-10-12', to: '2026-10-18', inflows: 0, outflows: 100 })
    expect(weeks[1]).toEqual({ from: '2026-10-19', to: '2026-10-25', inflows: 0, outflows: 40 })
    expect(weeks[4]).toEqual({ from: '2026-11-09', to: '2026-11-11', inflows: 0, outflows: 0 })
  })
})
```

- [ ] **Passo 2: Ver falhar**

Run: `npx vitest run src/app/reports/cash-flow/cash-flow-metrics.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Passo 3: Implementar**

Crie `cash-flow-metrics.ts`:

```ts
import { CashFlowWeek, DailyPoint, MovementDirection, MovementStatus } from 'mintly-lib'
import { fromCents, toCents } from '../../../core/money/money'
import { addDaysToDay } from '../shared/period'
import { CashFlowMovement, cashAmount, cashDay, isOverdue } from '../shared/cash-date'

/**
 * Regra pura do Fluxo de Caixa (spec 20261012, "Regra de cálculo"). Sem Mongo:
 * recebe as linhas que o repositório trouxe e devolve os números. Toda soma é
 * em CENTAVOS inteiros — float acumulado ao longo de 365 dias erra centavo.
 */

/** Margem de segurança do dia crítico, em dias de despesa média. Palpite — N13. */
export const SAFETY_DAYS = 7
/** Tamanho da série realizada (dias antes de hoje). */
export const REALIZED_DAYS = 7
/** Janela da média de saída que alimenta a margem de segurança. */
export const OUTFLOW_HISTORY_DAYS = 90
/** Tamanho do bloco de "Entradas × Saídas". */
export const WEEK_DAYS = 7

interface DayFlows { inflows: number; outflows: number }
const NO_FLOWS: DayFlows = { inflows: 0, outflows: 0 }

const isPending = (m: CashFlowMovement) => m.status === MovementStatus.Pending
export const isSettled = (m: CashFlowMovement) => m.status === MovementStatus.Settled

/** Entradas e saídas (centavos) por data de caixa. */
export function flowsByDay (movements: CashFlowMovement[], today: string): Map<string, DayFlows> {
  const flows = new Map<string, DayFlows>()
  for (const m of movements) {
    const day = cashDay(m, today)
    const current = flows.get(day) ?? { inflows: 0, outflows: 0 }
    const cents = toCents(cashAmount(m))
    if (m.direction === MovementDirection.In) current.inflows += cents
    else current.outflows += cents
    flows.set(day, current)
  }
  return flows
}

function point (date: string, balanceCents: number, f: DayFlows): DailyPoint {
  return { date, balance: fromCents(balanceCents), inflows: fromCents(f.inflows), outflows: fromCents(f.outflows) }
}

/**
 * Projeção diária: saldo no FIM de cada dia, de hoje até hoje + horizonte.
 * Hoje já inclui as vencidas (F1). O que vence depois do horizonte não entra
 * porque o laço termina antes.
 */
export function buildProjection (p: { today: string; horizon: number; cashToday: number; movements: CashFlowMovement[] }): DailyPoint[] {
  const flows = flowsByDay(p.movements.filter(isPending), p.today)
  const points: DailyPoint[] = []
  let balance = toCents(p.cashToday)
  for (let i = 0; i <= p.horizon; i++) {
    const date = addDaysToDay(p.today, i)
    const f = flows.get(date) ?? NO_FLOWS
    balance += f.inflows - f.outflows
    points.push(point(date, balance, f))
  }
  return points
}

/**
 * A receber / a pagar até o fim do horizonte, vencidas incluídas — senão
 * `projectedBalance` não fecharia com o último ponto da projeção. O bloco
 * `overdue` separa as vencidas para o destaque da tela (F2).
 */
export function summarizePending (movements: CashFlowMovement[], today: string, horizon: number) {
  const end = addDaysToDay(today, horizon)
  let receivable = 0
  let payable = 0
  let overdueCount = 0
  let overdueIn = 0
  let overdueOut = 0

  for (const m of movements.filter(isPending)) {
    if (cashDay(m, today) > end) continue
    const cents = toCents(cashAmount(m))
    const isIn = m.direction === MovementDirection.In
    if (isIn) receivable += cents
    else payable += cents
    if (isOverdue(m, today)) {
      overdueCount++
      if (isIn) overdueIn += cents
      else overdueOut += cents
    }
  }

  return {
    receivable: fromCents(receivable),
    payable: fromCents(payable),
    overdue: { count: overdueCount, receivable: fromCents(overdueIn), payable: fromCents(overdueOut) },
  }
}

/** Menor saldo da série; empate fica com o primeiro dia. `points` nunca é vazio (horizon ≥ 1). */
export function lowestPoint (points: DailyPoint[]): { date: string; balance: number } {
  let low = points[0]
  for (const p of points) {
    if (p.balance < low.balance) low = p
  }
  return { date: low.date, balance: low.balance }
}

/** Blocos de 7 dias a partir de hoje ("Sem 1" = hoje até hoje + 6). */
export function groupWeeks (points: DailyPoint[]): CashFlowWeek[] {
  const weeks: CashFlowWeek[] = []
  for (let i = 0; i < points.length; i += WEEK_DAYS) {
    const chunk = points.slice(i, i + WEEK_DAYS)
    weeks.push({
      from: chunk[0].date,
      to: chunk[chunk.length - 1].date,
      inflows: fromCents(chunk.reduce((sum, p) => sum + toCents(p.inflows), 0)),
      outflows: fromCents(chunk.reduce((sum, p) => sum + toCents(p.outflows), 0)),
    })
  }
  return weeks
}
```

- [ ] **Passo 4: Ver passar**

Run: `npx vitest run src/app/reports/cash-flow/cash-flow-metrics.spec.ts`
Expected: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/app/reports/cash-flow/cash-flow-metrics.ts src/app/reports/cash-flow/cash-flow-metrics.spec.ts
git commit -m "feat(reports): projecao, totais, menor saldo e semanas do fluxo de caixa"
```

---

## Tarefa 8 — Métricas: série realizada, margem de segurança, dia crítico e vencimentos

**Files:**
- Modify: `src/app/reports/cash-flow/cash-flow-metrics.ts`
- Test: `src/app/reports/cash-flow/cash-flow-metrics.spec.ts`

**Interfaces:**
- Consumes: `flowsByDay`, `isSettled`, constantes (Tarefa 7); `diffDays`, `addDaysToDay`, `toLocalDay` (Tarefa 5).
- Produces: `buildRealized(p: { today: string; cashToday: number; movements: CashFlowMovement[] }): DailyPoint[]`; `safetyThreshold(p: { today: string; outflowTotal: number; firstMovementDay: string | null }): { value: number; days: number; avgDailyOutflow: number }`; `criticalDayInsight(points: DailyPoint[], threshold: number): CriticalDayInsight | null`; `buildDueItems(movements, today, horizon): DueItem[]`.

- [ ] **Passo 1: Testes que falham**

Acrescente ao spec (e os nomes novos no `import` de `./cash-flow-metrics`):

```ts
describe('buildRealized', () => {
  it('7 pontos antes de hoje, reconstruídos a partir do caixa de hoje', () => {
    const points = buildRealized({
      today: TODAY,
      cashToday: 9000,
      movements: [
        mov({ status: MovementStatus.Settled, grossValue: 1880, date: at(TODAY), settledAt: at(TODAY) }),
        mov({ status: MovementStatus.Settled, grossValue: 1120, dueDate: at('2026-10-09'), settledAt: at('2026-10-10') }),
        mov({ status: MovementStatus.Settled, direction: MovementDirection.In, grossValue: 2950, netValue: 2950, dueDate: at('2026-10-08') }),
      ],
    })

    expect(points.map((p) => p.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(points.map((p) => p.balance)).toEqual([9050, 9050, 9050, 12000, 12000, 10880, 10880])
    expect(points[3]).toMatchObject({ inflows: 2950, outflows: 0 })
    expect(points[5]).toMatchObject({ inflows: 0, outflows: 1120 })
  })

  it('ignora pendentes', () => {
    const points = buildRealized({ today: TODAY, cashToday: 100, movements: [mov({ dueDate: at('2026-10-10') })] })
    expect(points.every((p) => p.balance === 100)).toBe(true)
  })
})

describe('safetyThreshold', () => {
  it('média sobre 90 dias quando há histórico suficiente', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 54000, firstMovementDay: '2026-07-04' }))
      .toEqual({ value: 4200, days: 7, avgDailyOutflow: 600 })
  })

  it('restaurante novo: divide pelos dias desde a primeira movimentação', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 1000, firstMovementDay: '2026-10-02' }))
      .toEqual({ value: 700, days: 7, avgDailyOutflow: 100 })
  })

  it('primeira movimentação hoje: divisor mínimo 1', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 0, firstMovementDay: TODAY }))
      .toEqual({ value: 0, days: 7, avgDailyOutflow: 0 })
  })

  it('sem nenhuma movimentação: limiar zero', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 0, firstMovementDay: null }))
      .toEqual({ value: 0, days: 7, avgDailyOutflow: 0 })
  })
})

describe('criticalDayInsight', () => {
  const pts = (balances: number[]) => balances.map((balance, i) => ({ date: `d${i}`, balance, inflows: 0, outflows: 0 }))

  it('primeiro dia abaixo do limiar', () => {
    expect(criticalDayInsight(pts([5000, 3000, 1000]), 4200))
      .toEqual({ kind: 'criticalDay', severity: 'warning', date: 'd1', balance: 3000, threshold: 4200 })
  })

  it('o próprio hoje pode ser crítico', () => {
    expect(criticalDayInsight(pts([100, 5000]), 4200)?.date).toBe('d0')
  })

  it('nenhum dia abaixo: sem insight', () => {
    expect(criticalDayInsight(pts([5000, 4200]), 4200)).toBeNull()
  })

  it('limiar zero: só saldo negativo dispara', () => {
    expect(criticalDayInsight(pts([0, 10]), 0)).toBeNull()
    expect(criticalDayInsight(pts([0, -1]), 0)?.date).toBe('d1')
  })
})

describe('buildDueItems', () => {
  it('só movimentação com vencimento, na janela, ordenada por vencimento e título', () => {
    const items = buildDueItems([
      mov({ title: 'Salários', dueDate: at('2026-10-22') }),
      mov({ title: 'Aluguel', dueDate: at('2026-10-22') }),
      mov({ title: 'Embalagens', dueDate: at('2026-10-04') }),
      mov({ title: 'Energia', status: MovementStatus.Settled, dueDate: at('2026-10-09'), settledAt: at('2026-10-10') }),
      mov({ title: 'Antigo pago', status: MovementStatus.Settled, dueDate: at('2026-09-01'), settledAt: at('2026-09-01') }),
      mov({ title: 'À vista', status: MovementStatus.Settled, date: at('2026-10-11'), settledAt: at('2026-10-11') }),
      mov({ title: 'Fora do horizonte', dueDate: at('2026-12-25') }),
      mov({ title: 'Cancelada', status: MovementStatus.Cancelled, dueDate: at('2026-10-15') }),
    ], TODAY, 30)

    expect(items.map((i) => i.title)).toEqual(['Embalagens', 'Energia', 'Aluguel', 'Salários'])
  })

  it('monta o item com valor de caixa, vencida e settledAt', () => {
    const [overdue, settled] = buildDueItems([
      mov({ id: 'p1', title: 'A', grossValue: 730, dueDate: at('2026-10-04') }),
      mov({ id: 's1', title: 'B', direction: MovementDirection.In, grossValue: 3000, netValue: 2950, status: MovementStatus.Settled, dueDate: at('2026-10-08') }),
    ], TODAY, 30)

    expect(overdue).toEqual({
      id: 'p1', title: 'A', category: { _id: 'c1', name: 'Categoria' }, direction: 'out',
      amount: 730, dueDate: '2026-10-04', status: 'pending', overdue: true,
    })
    expect(settled).toMatchObject({ id: 's1', amount: 2950, status: 'settled', overdue: false, settledAt: '2026-10-08' })
  })
})
```

- [ ] **Passo 2: Ver falhar**

Run: `npx vitest run src/app/reports/cash-flow/cash-flow-metrics.spec.ts`
Expected: FAIL — `buildRealized is not a function` (e os demais).

- [ ] **Passo 3: Implementar**

Acrescente ao topo de `cash-flow-metrics.ts` os imports `CriticalDayInsight, DueItem` (de
`mintly-lib`) e `diffDays, toLocalDay` (de `../shared/period`), e no fim do arquivo:

```ts
/**
 * Série realizada: saldo no fim de cada um dos 7 dias antes de hoje,
 * reconstruído para TRÁS a partir do caixa de hoje desfazendo o que liquidou
 * em cada dia. Usa todas as liquidadas, inclusive à vista. Limitação: edição
 * retroativa reescreve o passado desenhado (N12).
 */
export function buildRealized (p: { today: string; cashToday: number; movements: CashFlowMovement[] }): DailyPoint[] {
  const flows = flowsByDay(p.movements.filter(isSettled), p.today)
  const todayFlows = flows.get(p.today) ?? NO_FLOWS
  let balance = toCents(p.cashToday) - (todayFlows.inflows - todayFlows.outflows)

  const points: DailyPoint[] = []
  for (let i = 1; i <= REALIZED_DAYS; i++) {
    const date = addDaysToDay(p.today, -i)
    const f = flows.get(date) ?? NO_FLOWS
    points.unshift(point(date, balance, f))
    balance -= f.inflows - f.outflows
  }
  return points
}

/**
 * Margem de segurança do dia crítico (F3): SAFETY_DAYS dias de despesa média.
 * O divisor conta desde a primeira movimentação do restaurante (no máximo 90):
 * dividir sempre por 90 faria um restaurante com 10 dias de uso nunca ver
 * alerta. Sem histórico, o limiar é 0 e só saldo negativo dispara.
 */
export function safetyThreshold (p: { today: string; outflowTotal: number; firstMovementDay: string | null }) {
  if (p.firstMovementDay == null) {
    return { value: 0, days: SAFETY_DAYS, avgDailyOutflow: 0 }
  }
  const historyDays = Math.max(1, Math.min(OUTFLOW_HISTORY_DAYS, diffDays(p.firstMovementDay, p.today)))
  const avgCents = Math.round(toCents(p.outflowTotal) / historyDays)
  return { value: fromCents(avgCents * SAFETY_DAYS), days: SAFETY_DAYS, avgDailyOutflow: fromCents(avgCents) }
}

/** Primeiro dia da projeção com saldo ABAIXO do limiar (igual ao limiar não é crítico). */
export function criticalDayInsight (points: DailyPoint[], threshold: number): CriticalDayInsight | null {
  const hit = points.find((p) => p.balance < threshold)
  if (!hit) return null
  return { kind: 'criticalDay', severity: 'warning', date: hit.date, balance: hit.balance, threshold }
}

/**
 * Lista de vencimentos: só movimentação COM vencimento — venda à vista não
 * entra, senão a lista vira extrato. Janela: pendentes até o fim do horizonte
 * (vencidas incluídas) + liquidadas nos últimos REALIZED_DAYS dias. Filtros e
 * agrupamento por dia são do front.
 */
export function buildDueItems (movements: CashFlowMovement[], today: string, horizon: number): DueItem[] {
  const end = addDaysToDay(today, horizon)
  const realizedFrom = addDaysToDay(today, -REALIZED_DAYS)

  const inWindow = (m: CashFlowMovement): boolean => {
    const day = cashDay(m, today)
    if (isPending(m)) return day <= end
    if (isSettled(m)) return day >= realizedFrom && day <= today
    return false
  }

  return movements
    .filter((m) => m.dueDate != null && inWindow(m))
    .map((m) => {
      const item: DueItem = {
        id: m.id,
        title: m.title,
        category: m.category,
        direction: m.direction,
        amount: cashAmount(m),
        dueDate: toLocalDay(m.dueDate!),
        status: m.status as DueItem['status'],
        overdue: isOverdue(m, today),
      }
      if (isSettled(m)) item.settledAt = cashDay(m, today)
      return item
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, 'pt-BR'))
}
```

- [ ] **Passo 4: Ver passar**

Run: `npx vitest run src/app/reports/cash-flow/cash-flow-metrics.spec.ts`
Expected: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/app/reports/cash-flow/cash-flow-metrics.ts src/app/reports/cash-flow/cash-flow-metrics.spec.ts
git commit -m "feat(reports): serie realizada, margem de seguranca, dia critico e vencimentos"
```

---

## Tarefa 9 — Métricas: o relatório completo

**Files:**
- Modify: `src/app/reports/cash-flow/cash-flow-metrics.ts`
- Test: `src/app/reports/cash-flow/cash-flow-metrics.spec.ts`

**Interfaces:**
- Produces: `CashFlowInput { today: string; horizon: number; cashToday: number; movements: CashFlowMovement[]; outflowHistory: { total: number; firstMovementDay: string | null } }`; `computeCashFlow(input: CashFlowInput): CashFlowReport`.

- [ ] **Passo 1: Testes que falham**

```ts
describe('computeCashFlow', () => {
  it('monta o relatório e fecha projectedBalance com o último ponto', () => {
    const report = computeCashFlow({
      today: TODAY,
      horizon: 30,
      cashToday: 9000,
      movements: [
        mov({ title: 'Embalagens', grossValue: 730, dueDate: at('2026-10-04') }),
        mov({ title: 'Recebível', direction: MovementDirection.In, grossValue: 2900, netValue: 2900, dueDate: at('2026-10-17') }),
        mov({ title: 'Salários', grossValue: 5400, dueDate: at('2026-10-22') }),
      ],
      outflowHistory: { total: 54000, firstMovementDay: '2026-07-01' },
    })

    expect(report).toMatchObject({
      horizon: 30,
      today: TODAY,
      cashToday: 9000,
      receivable: 2900,
      payable: 6130,
      projectedBalance: 5770,
      lowestBalance: { date: '2026-10-22', balance: 5770 },
      overdue: { count: 1, receivable: 0, payable: 730 },
      safetyThreshold: { value: 4200, days: 7, avgDailyOutflow: 600 },
      insights: [],
    })
    expect(report.projection).toHaveLength(31)
    expect(report.projection[30].balance).toBe(report.projectedBalance)
    expect(report.realized).toHaveLength(7)
    expect(report.weeks).toHaveLength(5)
    expect(report.dueItems.map((i) => i.title)).toEqual(['Embalagens', 'Recebível', 'Salários'])
  })

  it('dia crítico vira insight', () => {
    const report = computeCashFlow({
      today: TODAY,
      horizon: 30,
      cashToday: 5000,
      movements: [mov({ grossValue: 2000, dueDate: at('2026-10-15') })],
      outflowHistory: { total: 54000, firstMovementDay: '2026-07-01' },
    })
    expect(report.insights).toEqual([{ kind: 'criticalDay', severity: 'warning', date: '2026-10-15', balance: 3000, threshold: 4200 }])
  })

  it('restaurante sem nenhuma movimentação: tudo zero, sem quebrar', () => {
    const report = computeCashFlow({ today: TODAY, horizon: 30, cashToday: 0, movements: [], outflowHistory: { total: 0, firstMovementDay: null } })
    expect(report).toMatchObject({ receivable: 0, payable: 0, projectedBalance: 0, lowestBalance: { date: TODAY, balance: 0 }, dueItems: [], insights: [] })
  })
})
```

(`computeCashFlow` no `import`.)

- [ ] **Passo 2: Ver falhar**

Run: `npx vitest run src/app/reports/cash-flow/cash-flow-metrics.spec.ts -t computeCashFlow`
Expected: FAIL — `computeCashFlow is not a function`.

- [ ] **Passo 3: Implementar**

Acrescente `CashFlowReport` ao import de `mintly-lib` e, no fim do arquivo:

```ts
export interface CashFlowInput {
  today: string
  horizon: number
  cashToday: number
  movements: CashFlowMovement[]
  outflowHistory: { total: number; firstMovementDay: string | null }
}

/** O relatório inteiro, a partir das linhas e dos agregados que o repositório trouxe. */
export function computeCashFlow (input: CashFlowInput): CashFlowReport {
  const { today, horizon, cashToday, movements, outflowHistory } = input

  const projection = buildProjection({ today, horizon, cashToday, movements })
  const pending = summarizePending(movements, today, horizon)
  const threshold = safetyThreshold({ today, outflowTotal: outflowHistory.total, firstMovementDay: outflowHistory.firstMovementDay })
  const critical = criticalDayInsight(projection, threshold.value)

  return {
    horizon,
    today,
    cashToday,
    receivable: pending.receivable,
    payable: pending.payable,
    projectedBalance: projection[projection.length - 1].balance,
    lowestBalance: lowestPoint(projection),
    overdue: pending.overdue,
    safetyThreshold: threshold,
    projection,
    realized: buildRealized({ today, cashToday, movements }),
    weeks: groupWeeks(projection),
    dueItems: buildDueItems(movements, today, horizon),
    insights: critical ? [critical] : [],
  }
}
```

- [ ] **Passo 4: Ver passar + cobertura do arquivo**

Run: `npx vitest run src/app/reports --coverage --coverage.include=src/app/reports/**`
Expected: PASS; `cash-flow-metrics.ts`, `period.ts` e `cash-date.ts` com 100% de linhas
e ≥ 90% de branches. Se algum ramo ficar descoberto, escreva o teste que o exercita
— não exclua o arquivo.

- [ ] **Passo 5: Commit**

```bash
git add src/app/reports/cash-flow/cash-flow-metrics.ts src/app/reports/cash-flow/cash-flow-metrics.spec.ts
git commit -m "feat(reports): computeCashFlow monta o relatorio completo"
```

---

## Tarefa 10 — Repositório, query, rota e o cenário de conferência

**Files:**
- Create: `src/app/reports/cash-flow/cash-flow-repository.ts`
- Create: `src/app/reports/cash-flow/use-cases/cash-flow.query.ts`
- Create: `src/app/reports/cash-flow/cash-flow-controller.ts`
- Create: `src/app/reports/cash-flow/cash-flow-routes.ts`
- Create: `src/app/reports/cash-flow/cash-flow-scenario.ts`
- Modify: `src/infrastructure/server/build-server.ts`
- Modify: `src/infrastructure/db/indices/financial-movements.ts`
- Test: `src/app/reports/cash-flow/cash-flow.int.spec.ts`

**Interfaces:**
- Consumes: `computeCashFlow`, `REALIZED_DAYS`, `OUTFLOW_HISTORY_DAYS` (Tarefas 7–9); `toLocalDay`, `addDaysToDay`, `startOfLocalDay` (Tarefa 5); `CashFlowMovement` (Tarefa 6).
- Produces: `CashFlowRepository` com `findWindowMovements(ctx, { realizedFrom: Date; projectionEnd: Date }): Promise<CashFlowMovement[]>`, `outflowHistory(ctx, { from: Date; to: Date }): Promise<{ total: number; firstMovementAt: Date | null }>`, `cashToday(ctx): Promise<number>`; `CashFlowQuery.execute(ctx, horizon?)`; rota `GET /reports/cash-flow`; `SEED_MARKER`, `cashFlowScenarioAccounts(restaurantId)`, `cashFlowScenarioMovements(today, refs)`, `cashFlowScenarioExpected(today, horizon)`.

- [ ] **Passo 1: O cenário**

Crie `cash-flow-scenario.ts`. Ele é a fixture da integração e o conteúdo do
`db:seed-demo` (Tarefa 11) — os números esperados estão calculados à mão no
comentário:

```ts
import { Decimal128 } from 'mongodb'
import { toDecimal128 } from '../../../core/money/money'
import { addDaysToDay, startOfLocalDay } from '../shared/period'

/**
 * Cenário determinístico do Fluxo de Caixa, relativo a "hoje" (d0). Serve ao
 * teste de integração E ao `npm run db:seed-demo` — os dois conferem os mesmos
 * números, então não divergem.
 *
 * Conta ativa com R$ 9.000 disponível; conta inativa com R$ 50.000 (não entra).
 *
 *   Liquidadas
 *   S1 entrada  1.000  date d-100               (primeira movimentação)
 *   S2 saída   52.880  date d-60                (histórico de saída)
 *   S3 saída    1.120  vence d-3, pago em d-2   (Energia — pago com atraso)
 *   S4 entrada  2.950  vence d-4, recebido d-4  (Repasse iFood)
 *   S5 saída    1.880  à vista hoje
 *   Pendentes
 *   P1 saída      730  vence d-8   (vencida)
 *   P2 saída      620  vence d-2   (vencida)
 *   P3 entrada  2.900  vence d+5
 *   P4 saída    2.200  vence d+10  (Aluguel)
 *   P5 saída    5.400  vence d+10  (Salários)
 *   P6 entrada  3.600  vence d+12
 *   P7 saída    1.000  vence d+40  (só no horizonte de 60)
 *   C1 saída    5.000  vence d+3   (cancelada — não aparece em nada)
 *
 * Histórico de saída [d-90, d0): S2 + S3 = 54.000 em 90 dias → 600/dia → margem 4.200.
 * Projeção (h30): d0 = 9.000 − 730 − 620 = 7.650; d5 = 10.550; d10 = 2.950 (menor
 * saldo e dia crítico, abaixo de 4.200); d12 em diante = 6.550.
 * Realizada: fim de ontem = 9.000 + 1.880 = 10.880; d-2 paga 1.120 → 12.000 antes;
 * d-4 recebe 2.950 → 9.050 antes.
 */
export const SEED_MARKER = 'seed-demo:cash-flow'

export interface ScenarioRefs {
  restaurantId: string
  account: { _id: string; name: string; type: string }
  revenueCategory: { _id: string; name: string }
  expenseCategory: { _id: string; name: string }
}

const audit = () => ({ createdAt: new Date(), updatedAt: new Date() })

export function cashFlowScenarioAccounts (restaurantId: string): Record<string, unknown>[] {
  return [
    { restaurantId, name: 'Demo · Caixa', type: 'cash', status: 'active', isDefault: false, availableBalance: toDecimal128(9000), predictedBalance: toDecimal128(0), audit: audit() },
    { restaurantId, name: 'Demo · Conta encerrada', type: 'bank', status: 'inactive', isDefault: false, availableBalance: toDecimal128(50000), predictedBalance: toDecimal128(0), audit: audit() },
  ]
}

interface Line {
  title: string
  direction: 'in' | 'out'
  status: 'pending' | 'settled' | 'cancelled'
  gross: number
  date: number
  due?: number
  settled?: number
}

const LINES: Line[] = [
  { title: 'Venda inaugural', direction: 'in', status: 'settled', gross: 1000, date: -100, settled: -100 },
  { title: 'Fornecedor Carnes (trimestral)', direction: 'out', status: 'settled', gross: 52880, date: -60, settled: -60 },
  { title: 'Energia elétrica', direction: 'out', status: 'settled', gross: 1120, date: -10, due: -3, settled: -2 },
  { title: 'Repasse iFood', direction: 'in', status: 'settled', gross: 2950, date: -34, due: -4, settled: -4 },
  { title: 'Compra no mercado', direction: 'out', status: 'settled', gross: 1880, date: 0, settled: 0 },
  { title: 'Fornecedor Embalagens', direction: 'out', status: 'pending', gross: 730, date: -20, due: -8 },
  { title: 'Taxas de cartão', direction: 'out', status: 'pending', gross: 620, date: -5, due: -2 },
  { title: 'Recebível cartão de crédito', direction: 'in', status: 'pending', gross: 2900, date: -1, due: 5 },
  { title: 'Aluguel do ponto', direction: 'out', status: 'pending', gross: 2200, date: 0, due: 10 },
  { title: 'Salários — 2ª parcela', direction: 'out', status: 'pending', gross: 5400, date: 0, due: 10 },
  { title: 'Repasse iFood — quinzena', direction: 'in', status: 'pending', gross: 3600, date: 0, due: 12 },
  { title: 'Fornecedor Hortifruti', direction: 'out', status: 'pending', gross: 1000, date: 0, due: 40 },
  { title: 'Compra cancelada', direction: 'out', status: 'cancelled', gross: 5000, date: 0, due: 3 },
]

export function cashFlowScenarioMovements (today: string, refs: ScenarioRefs): Record<string, unknown>[] {
  // Meio-dia local: longe da virada do dia em qualquer fuso de teste.
  const at = (offset: number) => new Date(startOfLocalDay(addDaysToDay(today, offset)).getTime() + 12 * 60 * 60 * 1000)

  return LINES.map((l) => {
    const money: Decimal128 = toDecimal128(l.gross)
    const doc: Record<string, unknown> = {
      restaurantId: refs.restaurantId,
      title: l.title,
      direction: l.direction,
      status: l.status,
      statusSource: 'auto',
      date: at(l.date),
      grossValue: money,
      feeValue: toDecimal128(0),
      netValue: money,
      account: refs.account,
      category: l.direction === 'in'
        ? { ...refs.revenueCategory, type: 'revenue' }
        : { ...refs.expenseCategory, type: 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      description: SEED_MARKER,
      history: [],
      audit: audit(),
    }
    if (l.due != null) doc.dueDate = at(l.due)
    if (l.settled != null) doc.settledAt = at(l.settled)
    return doc
  })
}

/** O que o endpoint TEM que devolver para o cenário acima. */
export function cashFlowScenarioExpected (today: string, horizon: 30 | 60) {
  const d = (offset: number) => addDaysToDay(today, offset)
  const dueTitles30 = [
    'Fornecedor Embalagens',
    'Repasse iFood',
    'Energia elétrica',
    'Taxas de cartão',
    'Recebível cartão de crédito',
    'Aluguel do ponto',
    'Salários — 2ª parcela',
    'Repasse iFood — quinzena',
  ]

  return {
    cashToday: 9000,
    receivable: 6500,
    payable: horizon === 30 ? 8950 : 9950,
    projectedBalance: horizon === 30 ? 6550 : 5550,
    lowestBalance: { date: d(10), balance: 2950 },
    overdue: { count: 2, receivable: 0, payable: 1350 },
    safetyThreshold: { value: 4200, days: 7, avgDailyOutflow: 600 },
    insights: [{ kind: 'criticalDay', severity: 'warning', date: d(10), balance: 2950, threshold: 4200 }],
    projectionLength: horizon + 1,
    realizedBalances: [9050, 9050, 9050, 12000, 12000, 10880, 10880],
    week1: { from: d(0), to: d(6), inflows: 2900, outflows: 1350 },
    dueItemTitles: horizon === 30 ? dueTitles30 : [...dueTitles30, 'Fornecedor Hortifruti'],
  }
}
```

- [ ] **Passo 2: Testes de integração que falham**

Crie `cash-flow.int.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { toDecimal128 } from '../../../core/money/money'
import { addDaysToDay, toLocalDay, startOfLocalDay } from '../shared/period'
import { cashFlowScenarioAccounts, cashFlowScenarioExpected, cashFlowScenarioMovements } from './cash-flow-scenario'

let envCounter = 0
const freshEnv = () => `int_cash_flow_${++envCounter}`

describe('GET /reports/cash-flow (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  async function signup (env: string, tag: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: {
        person: { name: `Dono ${tag}`, phone: '11977777777' },
        password: 'Senha123',
        restaurantName: `Restaurante ${tag}`,
        termsAccepted: true,
        email: `dono_${tag}_${env}@teste.com`,
      },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string }
  }

  async function plantScenario (env: string, restaurantId: string) {
    const db = mongoConnection.getDatabase(env)
    const accounts = await db.collection('financial_accounts').insertMany(cashFlowScenarioAccounts(restaurantId))
    const accountId = String(accounts.insertedIds[0])
    const today = toLocalDay(new Date())
    await db.collection('financial_movements').insertMany(cashFlowScenarioMovements(today, {
      restaurantId,
      account: { _id: accountId, name: 'Demo · Caixa', type: 'cash' },
      revenueCategory: { _id: 'cat-rev', name: 'Vendas' },
      expenseCategory: { _id: 'cat-exp', name: 'Despesas' },
    }))
    return today
  }

  const get = (auth: Record<string, string>, query = '') =>
    app.inject({ method: 'GET', url: `/reports/cash-flow${query}`, headers: auth })

  it('confere o cenário no horizonte de 30 dias', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env, 'a')
    const today = await plantScenario(env, restaurantId)
    const expected = cashFlowScenarioExpected(today, 30)

    const res = await get(auth, '?horizon=30')

    expect(res.statusCode).toBe(200)
    const report = res.json().payload
    expect(report).toMatchObject({
      horizon: 30,
      today,
      cashToday: expected.cashToday,
      receivable: expected.receivable,
      payable: expected.payable,
      projectedBalance: expected.projectedBalance,
      lowestBalance: expected.lowestBalance,
      overdue: expected.overdue,
      safetyThreshold: expected.safetyThreshold,
      insights: expected.insights,
    })
    expect(report.projection).toHaveLength(expected.projectionLength)
    expect(report.realized.map((p: any) => p.balance)).toEqual(expected.realizedBalances)
    expect(report.weeks[0]).toEqual(expected.week1)
    expect(report.dueItems.map((i: any) => i.title)).toEqual(expected.dueItemTitles)
    expect(report.dueItems.find((i: any) => i.title === 'Energia elétrica')).toMatchObject({
      status: 'settled', dueDate: addDaysToDay(today, -3), settledAt: addDaysToDay(today, -2),
    })
    expect(report.dueItems.filter((i: any) => i.overdue).map((i: any) => i.title)).toEqual(['Fornecedor Embalagens', 'Taxas de cartão'])
  })

  it('trocar o horizonte recalcula os blocos', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await signup(env, 'b')
    const today = await plantScenario(env, restaurantId)
    const expected = cashFlowScenarioExpected(today, 60)

    const report = (await get(auth, '?horizon=60')).json().payload

    expect(report).toMatchObject({ horizon: 60, payable: expected.payable, projectedBalance: expected.projectedBalance })
    expect(report.projection).toHaveLength(expected.projectionLength)
    expect(report.dueItems.map((i: any) => i.title)).toEqual(expected.dueItemTitles)
  })

  it('sem query usa o horizonte padrão de 30', async () => {
    const env = freshEnv()
    const { auth } = await signup(env, 'c')

    const report = (await get(auth)).json().payload

    expect(report.horizon).toBe(30)
    expect(report.projection).toHaveLength(31)
  })

  it('restaurante recém-criado, sem movimentação: 200 com tudo zerado', async () => {
    const env = freshEnv()
    const { auth } = await signup(env, 'd')

    const res = await get(auth)

    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toMatchObject({ cashToday: 0, receivable: 0, payable: 0, dueItems: [], insights: [] })
  })

  it('dois restaurantes no mesmo ambiente não enxergam os números um do outro', async () => {
    const env = freshEnv()
    const a = await signup(env, 'a')
    const b = await signup(env, 'b')
    const today = await plantScenario(env, a.restaurantId)
    const db = mongoConnection.getDatabase(env)
    await db.collection('financial_accounts').insertOne({ restaurantId: b.restaurantId, name: 'Rica', type: 'cash', status: 'active', isDefault: false, availableBalance: toDecimal128(1000000), predictedBalance: toDecimal128(0), audit: { createdAt: new Date(), updatedAt: new Date() } })
    await db.collection('financial_movements').insertOne({
      restaurantId: b.restaurantId, title: 'Do outro restaurante', direction: 'out', status: 'pending', statusSource: 'auto',
      date: new Date(), dueDate: startOfLocalDay(addDaysToDay(today, 1)), grossValue: toDecimal128(99999), feeValue: toDecimal128(0), netValue: toDecimal128(99999),
      account: { _id: 'x', name: 'Rica', type: 'cash' }, category: { _id: 'y', name: 'Z', type: 'expense' },
      paymentMethod: 'pix', origin: 'manual', history: [], audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const reportA = (await get(a.auth)).json().payload
    const reportB = (await get(b.auth)).json().payload

    expect(reportA).toMatchObject({ cashToday: 9000, payable: 8950 })
    expect(reportA.dueItems.map((i: any) => i.title)).not.toContain('Do outro restaurante')
    expect(reportB).toMatchObject({ cashToday: 1000000, payable: 99999, receivable: 0 })
  })

  it.each(['0', '366', 'abc', '1.5'])('horizon=%s → 400', async (horizon) => {
    const env = freshEnv()
    const { auth } = await signup(env, `h${horizon.replace('.', '')}`)

    const res = await get(auth, `?horizon=${horizon}`)

    expect(res.statusCode).toBe(400)
  })

  it('sem token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/cash-flow', headers: { env: freshEnv() } })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Passo 3: Ver falhar**

Run: `npx vitest run src/app/reports/cash-flow/cash-flow.int.spec.ts`
Expected: FAIL — 404 na rota (os testes de 400 e 401 também falham com 404).

- [ ] **Passo 4: Repositório**

```ts
import { MovementDirection, MovementStatus, RecordStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { decimalToNumber } from '../../../core/money/money'
import { CashFlowMovement } from '../shared/cash-date'

/**
 * As três consultas do Fluxo de Caixa (spec, "Consultas"). Devolve linhas e
 * agregados crus; a regra é toda do `cash-flow-metrics`. TODA consulta filtra
 * `restaurantId` — num agregado, o vazamento entre tenants vira um número
 * maior no gráfico e ninguém percebe (design 1.1).
 */
export class CashFlowRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  /**
   * Pendentes com data de caixa até o fim do horizonte (vencidas de qualquer
   * data incluídas) + liquidadas com data de caixa desde `realizedFrom`. A data
   * de caixa da liquidada é `settledAt ?? dueDate ?? date`, por isso o `$or`
   * por presença de campo em vez de `$expr` — cada ramo usa índice.
   */
  async findWindowMovements (ctx: RequestContext, w: { realizedFrom: Date; projectionEnd: Date }): Promise<CashFlowMovement[]> {
    const docs = await this.db(ctx).collection('financial_movements').find(
      {
        restaurantId: ctx.restaurantId,
        $or: [
          { status: MovementStatus.Pending, dueDate: { $lt: w.projectionEnd } },
          { status: MovementStatus.Pending, dueDate: { $exists: false }, date: { $lt: w.projectionEnd } },
          { status: MovementStatus.Settled, settledAt: { $gte: w.realizedFrom } },
          { status: MovementStatus.Settled, settledAt: { $exists: false }, dueDate: { $gte: w.realizedFrom } },
          { status: MovementStatus.Settled, settledAt: { $exists: false }, dueDate: { $exists: false }, date: { $gte: w.realizedFrom } },
        ],
      },
      { projection: { title: 1, category: 1, direction: 1, status: 1, date: 1, dueDate: 1, settledAt: 1, grossValue: 1, netValue: 1 } },
    ).toArray()

    return docs.map((d) => ({
      id: String(d._id),
      title: d.title,
      category: { _id: String(d.category?._id), name: d.category?.name },
      direction: d.direction,
      status: d.status,
      date: d.date,
      dueDate: d.dueDate ?? undefined,
      settledAt: d.settledAt ?? undefined,
      grossValue: decimalToNumber(d.grossValue),
      netValue: decimalToNumber(d.netValue),
    }))
  }

  /** Σ saídas liquidadas com data de caixa em [from, to) + a primeira movimentação do restaurante. */
  async outflowHistory (ctx: RequestContext, w: { from: Date; to: Date }): Promise<{ total: number; firstMovementAt: Date | null }> {
    const movements = this.db(ctx).collection('financial_movements')
    const [agg] = await movements.aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: MovementStatus.Settled, direction: MovementDirection.Out } },
      { $addFields: { cashAt: { $ifNull: ['$settledAt', { $ifNull: ['$dueDate', '$date'] }] } } },
      { $match: { cashAt: { $gte: w.from, $lt: w.to } } },
      { $group: { _id: null, total: { $sum: '$grossValue' } } },
    ]).toArray()

    const first = await movements
      .find({ restaurantId: ctx.restaurantId, status: { $ne: MovementStatus.Cancelled } }, { projection: { date: 1 } })
      .sort({ date: 1 })
      .limit(1)
      .next()

    return { total: decimalToNumber(agg?.total), firstMovementAt: first?.date ?? null }
  }

  /** Σ availableBalance das contas ATIVAS (conta encerrada não é caixa). */
  async cashToday (ctx: RequestContext): Promise<number> {
    const [agg] = await this.db(ctx).collection('financial_accounts').aggregate([
      { $match: { restaurantId: ctx.restaurantId, status: RecordStatus.Active } },
      { $group: { _id: null, total: { $sum: '$availableBalance' } } },
    ]).toArray()
    return decimalToNumber(agg?.total)
  }
}
```

Se `RecordStatus` não for exportado por `mintly-lib`, use `'active'` com o mesmo comentário.

- [ ] **Passo 5: Query, controller e rota**

`use-cases/cash-flow.query.ts`:

```ts
import { CashFlowReport } from 'mintly-lib'
import { RequestContext } from '../../../../core/context/request-context'
import { addDaysToDay, startOfLocalDay, toLocalDay } from '../../shared/period'
import { CashFlowRepository } from '../cash-flow-repository'
import { OUTFLOW_HISTORY_DAYS, REALIZED_DAYS, computeCashFlow } from '../cash-flow-metrics'

export const DEFAULT_HORIZON = 30

/**
 * Fluxo de Caixa (MIN-94): resolve "hoje" no fuso dos relatórios, busca as
 * linhas e agregados e entrega à regra pura. Read-only. O relógio é injetável
 * para teste.
 */
export class CashFlowQuery {
  constructor (
    private readonly repo: CashFlowRepository = new CashFlowRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, horizon: number = DEFAULT_HORIZON): Promise<CashFlowReport> {
    const today = toLocalDay(this.clock())

    const [movements, history, cashToday] = await Promise.all([
      this.repo.findWindowMovements(ctx, {
        realizedFrom: startOfLocalDay(addDaysToDay(today, -REALIZED_DAYS)),
        projectionEnd: startOfLocalDay(addDaysToDay(today, horizon + 1)),
      }),
      this.repo.outflowHistory(ctx, {
        from: startOfLocalDay(addDaysToDay(today, -OUTFLOW_HISTORY_DAYS)),
        to: startOfLocalDay(today),
      }),
      this.repo.cashToday(ctx),
    ])

    return computeCashFlow({
      today,
      horizon,
      cashToday,
      movements,
      outflowHistory: {
        total: history.total,
        firstMovementDay: history.firstMovementAt ? toLocalDay(history.firstMovementAt) : null,
      },
    })
  }
}
```

`cash-flow-controller.ts`:

```ts
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { CashFlowQuery } from './use-cases/cash-flow.query'

export class CashFlowController {
  constructor (private readonly query: CashFlowQuery = new CashFlowQuery()) {}

  /** GET /reports/cash-flow?horizon= — o schema da rota já validou e aplicou o padrão. */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { horizon } = (request.query ?? {}) as { horizon?: number }
    const report = await this.query.execute(ctx, horizon)

    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
```

`cash-flow-routes.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { CashFlowController } from './cash-flow-controller'

export async function cashFlowRoutes (fastify: FastifyInstance) {
  const controller = new CashFlowController()

  // GET /reports/cash-flow?horizon=30 — horizonte de 1 a 365 dias (padrão 30).
  // Fora disso (ou não inteiro) o schema devolve 400 antes de chegar no controller.
  fastify.get('/cash-flow', {
    schema: {
      tags: ['reports'],
      summary: 'Fluxo de Caixa (MIN-94)',
      querystring: {
        type: 'object',
        properties: {
          horizon: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
  }, async (request: any, reply) => controller.get(request, reply))
}
```

Em `build-server.ts`: importe `cashFlowRoutes` de `'../../app/reports/cash-flow/cash-flow-routes'` e,
dentro do escopo protegido, depois de `financialMovementRoutes`:

```ts
    await protectedScope.register(cashFlowRoutes, { prefix: '/reports' })
```

- [ ] **Passo 6: Índice**

Em `financial-movements.ts`, no fim de `ensure`:

```ts
  // Fluxo de Caixa (fatia 2): liquidadas por `settledAt` dentro do restaurante —
  // série realizada e o histórico de saída da margem de segurança. Documentos
  // anteriores ao campo caem no `{ restaurantId, status, dueDate }` acima ou no
  // `{ restaurantId, date }`.
  await col.createIndex({ restaurantId: 1, status: 1, settledAt: 1 })
```

- [ ] **Passo 7: Ver passar**

Run: `npx vitest run src/app/reports`
Expected: PASS. Se `horizon=1.5` passar com 200, o Ajv da instância não está coagindo
como o padrão do Fastify — confira as opções de `buildServer` antes de mexer no schema.

- [ ] **Passo 8: Suíte inteira, lint e tipos**

Run: `npm run lint && npm run typecheck && npm run test:ci`
Expected: tudo verde, cobertura ≥ 90% nas quatro métricas.

- [ ] **Passo 9: Commit**

```bash
git add src/app/reports src/infrastructure/server/build-server.ts src/infrastructure/db/indices/financial-movements.ts
git commit -m "feat(reports): GET /reports/cash-flow (MIN-94)"
```

---

## Tarefa 11 — Seed de conferência, Insomnia e E2E

**Files:**
- Create: `scripts/app/seed-demo.ts`
- Modify: `package.json` (script `db:seed-demo`)
- Modify: `insomnia/MintlyApi.insomnia_v4.json`
- Create: `tests/e2e/cash-flow.e2e.spec.ts`

**Interfaces:**
- Consumes: `SEED_MARKER`, `cashFlowScenarioAccounts`, `cashFlowScenarioMovements`, `cashFlowScenarioExpected` (Tarefa 10).

- [ ] **Passo 1: Script**

`scripts/app/seed-demo.ts`:

```ts
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { toLocalDay } from '../../src/app/reports/shared/period'
import {
  SEED_MARKER,
  cashFlowScenarioAccounts,
  cashFlowScenarioExpected,
  cashFlowScenarioMovements,
} from '../../src/app/reports/cash-flow/cash-flow-scenario'

/**
 * Planta o cenário de conferência dos relatórios num restaurante, relativo a
 * hoje (design, Parte 4). Hoje só o Fluxo de Caixa; as próximas fatias
 * acrescentam os seus cenários aqui.
 *
 * Rode num restaurante RECÉM-CRIADO: contas e movimentos que já existirem nele
 * somam nos números e a conferência deixa de bater.
 *
 * Idempotente: apaga o que uma execução anterior plantou (contas "Demo · " e
 * movimentos marcados) antes de plantar de novo.
 *
 * Uso: `MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  const restaurantId = process.env.SEED_RESTAURANT_ID?.trim()
  if (!env || !restaurantId) {
    throw new Error('MONGO_ENV e SEED_RESTAURANT_ID são obrigatórios (ex.: MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo).')
  }
  if (env === 'production') {
    throw new Error('db:seed-demo não roda em produção.')
  }

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const db = connection.getDatabase(env)
    const accountsCol = db.collection('financial_accounts')
    const movementsCol = db.collection('financial_movements')

    await movementsCol.deleteMany({ restaurantId, description: SEED_MARKER })
    await accountsCol.deleteMany({ restaurantId, name: /^Demo · / })

    const accounts = await accountsCol.insertMany(cashFlowScenarioAccounts(restaurantId))
    const today = toLocalDay(new Date())
    const movements = cashFlowScenarioMovements(today, {
      restaurantId,
      account: { _id: String(accounts.insertedIds[0]), name: 'Demo · Caixa', type: 'cash' },
      revenueCategory: { _id: 'seed-demo-revenue', name: 'Vendas (demo)' },
      expenseCategory: { _id: 'seed-demo-expense', name: 'Despesas (demo)' },
    })
    await movementsCol.insertMany(movements)

    console.log(`Plantados: ${accounts.insertedCount} contas, ${movements.length} movimentos (env=${env}, restaurante=${restaurantId}, hoje=${today}).`)
    console.log('Esperado em GET /reports/cash-flow?horizon=30:')
    console.log(JSON.stringify(cashFlowScenarioExpected(today, 30), null, 2))
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

Em `package.json`, depois de `db:backfill-due-date`:
`"db:seed-demo": "tsx scripts/app/seed-demo.ts"`.

Confira o nome do método de desconexão em `MongoDBConnection` (o
`backfill-due-date.ts` usa o mesmo par connect/close) e use o mesmo.

- [ ] **Passo 2: Rodar o seed contra um Mongo em memória**

Mesma verificação da migração da fatia 1: suba um `mongodb-memory-server`, crie um
restaurante via signup e rode o script com `MONGODB_URI` apontando para ele.

```bash
npx eslint scripts/app/seed-demo.ts --ext .ts
```

Expected: lint limpo; a execução imprime as contagens e o JSON esperado; uma
segunda execução imprime as mesmas contagens (idempotente).

- [ ] **Passo 3: Insomnia**

No `insomnia/MintlyApi.insomnia_v4.json`, acrescente uma requisição na mesma pasta
das de movimentação, copiando os headers delas (`env`, `Authorization`):
`GET {{ _.base_url }}/reports/cash-flow?horizon=30`, nome `Fluxo de Caixa`. Abra a
collection no Insomnia para confirmar que o JSON continua válido.

- [ ] **Passo 4: E2E**

`tests/e2e/cash-flow.e2e.spec.ts`, no padrão de `financial-movement.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'
const DAY = 24 * 60 * 60 * 1000

/**
 * E2E do Fluxo de Caixa (MIN-94) — local-only, contra Atlas (env=e2e). Fecha
 * também a lacuna da fatia 1: saída com vencimento por HTTP real.
 */
describe('Cash Flow E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let auth: Record<string, string>
  let cashId: string
  let expenseCatId: string

  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('Defina MONGODB_URI no .env.e2e — copie de .env.e2e.example')
    }
    server = await buildServer()
    await mongoConnection.connect()
    await server.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3001) })
    const address = server.server.address()
    if (typeof address === 'string' || address === null) throw new Error('servidor sem endereço')
    baseUrl = `http://127.0.0.1:${address.port}`

    const signup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', env: E2E_DB },
      body: JSON.stringify({
        person: { name: 'E2E Caixa', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Caixa Rest',
        email: `caixa_e2e_${Date.now()}@teste.com`,
        termsAccepted: true,
      }),
    })
    expect(signup.status).toBe(201)
    const { accessToken, user } = (await signup.json() as any).payload
    auth = { 'Content-Type': 'application/json', env: E2E_DB, authorization: `Bearer ${accessToken}` }

    const db = mongoConnection.getDatabase(E2E_DB)
    cashId = String((await db.collection('financial_accounts').findOne({ restaurantId: user.restaurantId, isDefault: true }))!._id)
    expenseCatId = String((await db.collection('financial_categories').findOne({ restaurantId: user.restaurantId, type: 'expense' }))!._id)
  })

  afterAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db(E2E_DB).dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  it('saída com vencimento aparece no relatório como a pagar', async () => {
    const created = await fetch(`${baseUrl}/financial-movements/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        direction: 'out',
        title: 'Boleto E2E',
        grossValue: 321.45,
        date: new Date().toISOString(),
        dueDate: new Date(Date.now() + 3 * DAY).toISOString(),
        accountId: cashId,
        categoryId: expenseCatId,
        paymentMethod: 'boleto',
      }),
    })
    expect(created.status).toBe(201)
    expect((await created.json() as any).payload.status).toBe('pending')

    const res = await fetch(`${baseUrl}/reports/cash-flow?horizon=30`, { headers: auth })
    expect(res.status).toBe(200)
    const report = (await res.json() as any).payload

    expect(report.payable).toBe(321.45)
    expect(report.projectedBalance).toBe(report.cashToday - 321.45)
    expect(report.dueItems).toEqual([expect.objectContaining({ title: 'Boleto E2E', status: 'pending', overdue: false, amount: 321.45 })])
  })
})
```

- [ ] **Passo 5: Rodar o E2E**

Run: `npm run test:e2e`
Expected: os testes antigos e o novo verdes contra o Atlas (banco `e2e`, derrubado no fim).

- [ ] **Passo 6: Commit**

```bash
git add scripts/app/seed-demo.ts package.json insomnia/MintlyApi.insomnia_v4.json tests/e2e/cash-flow.e2e.spec.ts
git commit -m "test(reports): seed de conferencia, insomnia e E2E do fluxo de caixa"
```

---

## Tarefa 12 — Fechar a fatia: PRs, pacote publicado e docs

- [ ] **Passo 1: PR da lib**

No MintlyLib: `gh auth switch --user AlexandreDSptech` se preciso, e
`gh pr create --base staging --title "feat(reports): Fluxo de Caixa — contrato, client e settledAt (MIN-94)"`
com corpo listando: `settledAt` (aditivo, sem breaking), `ChangeMovementStatusRequest`,
tipos do relatório, `ReportClient`. Aguardar o merge do Alexandre.

- [ ] **Passo 2: Consumir o pacote publicado**

Depois do merge, a CI da lib publica `X.Y.Z-preview` (esperado `2.10.0-preview`). Na API:

```bash
npm view mintly-lib dist-tags
npm i mintly-lib@<versão publicada>
npm run lint && npm run typecheck && npm run test:ci
```

Expected: mesma suíte verde contra o pacote real (nada dependia do build copiado).

```bash
git add package.json package-lock.json
git commit -m "chore(deps): consome mintly-lib <versão> (fluxo de caixa)"
```

- [ ] **Passo 3: Docs**

- `specs/modulos-novos/andamento.md`: fatia 2 com os números dos PRs; "Passo atual" avança para o review.
- `specs/modulos-novos/pendencias-negocio.md`: N12 cita `settledAt` como melhoria parcial (o pagamento atrasado já cai no dia certo; edição retroativa continua sendo a limitação).

```bash
git add specs/modulos-novos
git commit -m "docs(modulos-novos): andamento da fatia 2"
```

- [ ] **Passo 4: PR da API**

Se o #39 já estiver mergeado: `git fetch && git rebase origin/staging`. Senão, o PR
é aberto com base `feat/20260929/status-por-vencimento` e retargetado para `staging`
depois do merge do #39.

`git push -u origin feat/20261012/fluxo-de-caixa` e
`gh pr create --title "feat(reports): Fluxo de Caixa (MIN-94)"`, corpo com: contrato,
regra, `settledAt`, os 9 critérios → testes (tabela da spec), resultado do E2E e
"nenhum comando novo no ambiente".

- [ ] **Passo 5: Esperar a CI**

`gh pr checks <n>` até fechar. Expected: verde.

---

## Self-review

- **Cobertura da spec:** contrato → Tarefa 2 (tipos) e 10 (rota); data de caixa → 6;
  projeção, totais, semanas → 7; realizada, limiar, dia crítico, lista → 8; montagem
  → 9; consultas e índice → 10; `settledAt` (lib) → 1; quem grava (API) → 3 e 4;
  testes unitários → 5–9; integração e isolamento → 4 e 10; E2E → 11; seed e
  Insomnia → 11; entrega → 12. Os 9 critérios da MIN-94 estão na integração da
  Tarefa 10 (1, 2, 3, 5, 6, 7, 8), nos unitários da 7–9 (3, 4, 5, 6, 7) e na CI (9).
- **Placeholders:** nenhum passo sem código. Dois pontos dependem de confirmação no
  código na hora (exportação de `RecordStatus` pela lib; nome do método de
  desconexão do `MongoDBConnection`) e dizem o que fazer em cada caso.
- **Tipos:** `CashFlowMovement` (Tarefa 6) é o mesmo em 7–10; `applyStatusTransition`
  devolve `{ settledAt?: Date }` (Tarefa 4) e só a Tarefa 4 consome; os nomes da lib
  (`CashFlowReport`, `DailyPoint`, `CashFlowWeek`, `DueItem`, `CriticalDayInsight`)
  batem entre a Tarefa 2 e as 7–10.
- **Números do cenário:** conferidos à mão no comentário de `cash-flow-scenario.ts`
  e repetidos no `computeCashFlow` da Tarefa 9 com um subconjunto menor (9.000 −
  730 + 2.900 − 5.400 = 5.770).
- **Review Focus:** os cinco itens têm teste — fuso (5 e 6), relógio adiantado (4),
  restaurante vazio (9 e 10), documento antigo (6 e 8), cancelada (7 e 8).
