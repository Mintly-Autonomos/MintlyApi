# Fatia 1 — `dueDate` na movimentação (MIN-89)

> **Para quem executa:** cada passo é uma ação de 2 a 5 minutos, na ordem
> escrever o teste que falha → ver falhar → implementar o mínimo → ver passar →
> commitar. Não pule o "ver falhar": um teste que passa antes da implementação
> não está testando o que você acha.

**Goal:** dar à movimentação um campo único de vencimento (`dueDate`), fazer o
status derivar dele e restringir a liquidação automática ao único dinheiro que
cai sozinho — entrada em conta plataforma.

**Architecture:** `dueDate` substitui `predictedReceiptDate` (breaking change na
lib). O status nasce da *presença* do vencimento e é reavaliado só quando o
vencimento passa a existir ou deixa de existir. Toda decisão vira função pura em
`movement-rules.ts`, testada isoladamente; os use-cases só orquestram.

**Tech Stack:** TypeScript, Sapphire (`@ascendance-hub/sapphire-core`), MongoDB
(driver nativo, transações), Jest na lib, Vitest na API.

**Spec:** `specs/modulos-novos/20260929/design.md`, seção **M1**.

**Jira:** história **MIN-89**; subtarefas **MIN-91** (lib, Tarefa 1), **MIN-92**
(API, Tarefas 2 a 9), **MIN-93** (migração, Tarefa 10).

## Global Constraints

- Nomes em inglês; campos em camelCase; collections em snake_case plural.
- Commits em português, conventional commits, escopo quando fizer sentido.
- Cobertura mínima de 90% em lines, statements, branches e functions. `npm run test:ci` falha abaixo disso.
- Dinheiro é `Decimal128` na persistência e `number` no domínio. `dueDate` é `Date` nos dois lados — não passa por `movementToStorage`.
- Toda leitura e escrita de movimentação é escopada por `restaurantId`, exceto o settler, que é cross-tenant por desenho e roda fora de request.
- Uma subtarefa do Jira = uma branch.

---

## File Structure

**MintlyLib**

| Arquivo | Responsabilidade |
|---|---|
| `src/core/data/financial/financial-movement-schema.ts` | `dueDate` entra no schema base, no de registro e no de edição; `predictedReceiptDate` sai |
| `src/core/data/financial/financial-movement-schema.spec.ts` | Testes dos três schemas |

**MintlyApi**

| Arquivo | Responsabilidade |
|---|---|
| `src/app/financial-movement/movement-rules.ts` | Regras puras: `computeSnapshot`, `defaultStatus`, `resolveDueDate`, `shouldRecomputeStatus`. `resolveStatusSource` é removida |
| `src/app/financial-movement/movement-rules.spec.ts` | Unitários das regras |
| `src/app/financial-movement/use-cases/register-movement.use-case.ts` | Grava `dueDate` e o status derivado |
| `src/app/financial-movement/use-cases/update-movement.use-case.ts` | Resolve o `dueDate` do doc novo e recomputa o status nos dois sentidos |
| `src/app/financial-movement/use-cases/settle-due-movements.use-case.ts` | Filtro por `dueDate`, restrito a entrada de conta plataforma |
| `src/infrastructure/db/indices/financial-movements.ts` | Índices por vencimento |
| `scripts/movements/backfill-due-date.ts` | Migração `predictedReceiptDate` → `dueDate` |

Por que as quatro decisões moram em `movement-rules.ts` e não nos use-cases: elas
são funções de dados para dados, sem Mongo e sem `RequestContext`. Testá-las
custa milissegundos e cobre os ramos que, dentro de uma transação, exigiriam um
banco de pé. É o padrão que o arquivo já segue.

---

## Tarefa 1 — MintlyLib: `dueDate` no contrato (MIN-91)

**Branch:** `feat/20260929/movimento-due-date` (repositório MintlyLib)

**Files:**
- Modify: `src/core/data/financial/financial-movement-schema.ts`
- Test: `src/core/data/financial/financial-movement-schema.spec.ts`

**Interfaces:**
- Produces: campo `dueDate?: Date` no `financialMovementSchema`, no
  `registerMovementSchema` e no `updateMovementSchema`. O campo
  `predictedReceiptDate` deixa de existir.

- [ ] **Passo 1: Escrever os testes que falham**

Em `financial-movement-schema.spec.ts`, acrescente:

```ts
describe('dueDate', () => {
  it('aceita movimento com dueDate', () => {
    const doc = { ...validInMovement(), dueDate: new Date('2026-07-16T00:00:00.000Z') }

    expect(() => financialMovementSchema.parse(doc)).not.toThrow()
  })

  it('aceita movimento sem dueDate (à vista)', () => {
    expect(() => financialMovementSchema.parse(validInMovement())).not.toThrow()
  })

  it('coage dueDate em ISO string para Date', () => {
    const doc = { ...validInMovement(), dueDate: '2026-07-16T00:00:00.000Z' }

    const parsed: any = financialMovementSchema.parse(doc)

    expect(parsed.dueDate).toBeInstanceOf(Date)
  })

  it('rejeita predictedReceiptDate: o campo não existe mais', () => {
    const doc = { ...validInMovement(), predictedReceiptDate: new Date() }

    expect(() => financialMovementSchema.parse(doc)).toThrow()
  })

  it('aceita dueDate no registro', () => {
    const input = {
      direction: MovementDirection.Out,
      title: 'Fornecedor Hortifruti',
      grossValue: 2100,
      date: '2026-07-01T00:00:00.000Z',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      paymentMethod: PaymentMethod.Boleto,
      dueDate: '2026-07-19T00:00:00.000Z',
    }

    expect(() => registerMovementSchema.parse(input)).not.toThrow()
  })

  it('aceita dueDate na edição', () => {
    expect(() => updateMovementSchema.parse({ dueDate: '2026-07-19T00:00:00.000Z' })).not.toThrow()
  })
})
```

Acrescente `updateMovementSchema` ao import no topo do arquivo, se ainda não estiver lá.

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm test -- financial-movement-schema`
Esperado: FAIL. Os testes de `dueDate` quebram porque o campo não existe no objeto
estrito; o de `predictedReceiptDate` passa por engano — ele ainda existe.

- [ ] **Passo 3: Implementar**

Em `financial-movement-schema.ts`, dentro de `baseMovementSchema`, troque a linha
do `predictedReceiptDate` por `dueDate` e atualize o comentário do bloco:

```ts
  // Snapshot da conta `platform` no momento do registro (mudança futura na
  // conta não altera o histórico). Ausentes em contas sem prazo/taxa.
  feePercentApplied: s.number().min(0).max(100).optional(),
  settlementDaysApplied: s.number().int().min(0).optional(),

  /**
   * Vencimento: o dia em que o dinheiro entra ou sai. Campo ÚNICO — vale tanto
   * para o repasse da plataforma (calculado pelo sistema: data + prazo da conta)
   * quanto para o boleto do fornecedor (informado pelo dono). Ausente significa
   * à vista, e é isso que faz o movimento nascer liquidado.
   *
   * Substitui o antigo `predictedReceiptDate`, que só existia para entrada de
   * plataforma e não tinha onde guardar conta a pagar.
   */
  dueDate: s.date().coerce().optional(),
```

Em `registerMovementSchema`, depois de `status`:

```ts
  status: s.type().enum(MovementStatus).optional(),
  // Vencimento informado pelo dono. Em conta `platform` o sistema calcula
  // sozinho quando este campo não vem.
  dueDate: s.date().coerce().optional(),
```

Em `updateMovementSchema`, depois de `status` (o `.partial()` no fim já torna
tudo opcional):

```ts
  status: s.type().enum(MovementStatus),
  dueDate: s.date().coerce(),
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm test -- financial-movement-schema`
Esperado: PASS, incluindo o teste que rejeita `predictedReceiptDate`.

Rode também: `npm run typecheck && npm run lint`
Esperado: sem erro.

- [ ] **Passo 5: Commit**

```bash
git add src/core/data/financial/financial-movement-schema.ts src/core/data/financial/financial-movement-schema.spec.ts
git commit -m "feat(movimento)!: dueDate como campo unico de vencimento (M1)

O repasse da plataforma que cai no dia 19 e o boleto que vence no dia 19 sao o
mesmo conceito: quando o dinheiro encosta no caixa. Dois campos obrigariam todo
relatorio a desempatar dueDate ?? predictedReceiptDate ?? date.

predictedReceiptDate sai do schema. settlementDaysApplied e feePercentApplied
ficam: continuam sendo o snapshot congelado do prazo e da taxa (P3).

BREAKING CHANGE: predictedReceiptDate nao existe mais no contrato da
movimentacao. Quem le o campo passa a ler dueDate."
```

- [ ] **Passo 6: Abrir o PR e conferir a publicação**

Abra o PR para `staging`. Depois do merge, o `ci.yml` faz o bump (o `!` no commit
sinaliza major) e o `deploy.yml` publica com a dist-tag `preview`. Anote a versão
publicada — a Tarefa 2 precisa dela.

---

## Tarefa 2 — MintlyApi: consumir a lib nova (MIN-92)

**Branch:** `feat/20260929/status-por-vencimento` (repositório MintlyApi — já
existe, com os dois commits de documentação)

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `dueDate` do `financialMovementSchema` (Tarefa 1).

- [ ] **Passo 1: Instalar a versão publicada**

```bash
npm i mintly-lib@<versão-publicada-na-tarefa-1>
```

- [ ] **Passo 2: Ver o que quebrou**

Rode: `npm run typecheck`
Esperado: FAIL. O `financialMovementSchema.parse(doc)` não acusa em tempo de
compilação, mas as referências a `predictedReceiptDate` em
`register-movement.use-case.ts:114`, `update-movement.use-case.ts:145-155,197` e
`settle-due-movements.use-case.ts:23` continuam compilando por serem acesso a
`Record<string, any>`. Registre a lista — as próximas tarefas resolvem uma a uma.

Rode: `npm run test:unit`
Esperado: FAIL nos testes que montam documento com `predictedReceiptDate`, porque
agora o schema estrito rejeita o campo.

- [ ] **Passo 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): consome mintly-lib com dueDate

A suite fica vermelha a partir daqui ate a tarefa 9 — o campo predictedReceiptDate
foi removido do contrato e o codigo ainda o grava."
```

---

## Tarefa 3 — `computeSnapshot` devolve `dueDate` (MIN-92)

**Files:**
- Modify: `src/app/financial-movement/movement-rules.ts:75-140`
- Test: `src/app/financial-movement/movement-rules.spec.ts`

**Interfaces:**
- Produces: `MovementSnapshot.dueDate?: Date` no lugar de `predictedReceiptDate`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
describe('computeSnapshot — dueDate', () => {
  const platform = { type: 'platform', feePercent: 10, settlementDays: 30 }

  it('entrada em conta plataforma com prazo ganha dueDate = data + prazo', () => {
    const snapshot = computeSnapshot({
      direction: MovementDirection.In,
      grossValue: 1000,
      date: new Date('2026-07-01T00:00:00.000Z'),
      account: platform,
    })

    expect(snapshot.dueDate).toEqual(new Date('2026-07-31T00:00:00.000Z'))
    expect(snapshot.settlementDaysApplied).toBe(30)
  })

  it('prazo ZERO não gera dueDate, mas registra o prazo aplicado', () => {
    const snapshot = computeSnapshot({
      direction: MovementDirection.In,
      grossValue: 1000,
      date: new Date('2026-07-01T00:00:00.000Z'),
      account: { type: 'platform', feePercent: 10, settlementDays: 0 },
    })

    expect(snapshot.dueDate).toBeUndefined()
    expect(snapshot.settlementDaysApplied).toBe(0)
  })

  it('saída não ganha dueDate calculado, mesmo em conta plataforma', () => {
    const snapshot = computeSnapshot({
      direction: MovementDirection.Out,
      grossValue: 1000,
      date: new Date('2026-07-01T00:00:00.000Z'),
      account: platform,
    })

    expect(snapshot.dueDate).toBeUndefined()
    expect(snapshot.feeValue).toBe(0)
  })

  it('entrada em conta comum não ganha dueDate calculado', () => {
    const snapshot = computeSnapshot({
      direction: MovementDirection.In,
      grossValue: 1000,
      date: new Date('2026-07-01T00:00:00.000Z'),
      account: { type: 'bank' },
    })

    expect(snapshot.dueDate).toBeUndefined()
  })
})
```

No mesmo arquivo, troque `predictedReceiptDate` por `dueDate` nas asserções dos
testes que já existem de `computeSnapshot`.

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm run test:unit -- movement-rules`
Esperado: FAIL — `snapshot.dueDate` é `undefined` em todos os casos, porque a
propriedade ainda se chama `predictedReceiptDate`. O teste do prazo zero falha
por outro motivo e é o que importa: hoje ele produz data igual à do lançamento.

- [ ] **Passo 3: Implementar**

Em `movement-rules.ts`, na interface:

```ts
export interface MovementSnapshot {
  feeValue: number
  netValue: number
  feePercentApplied?: number
  settlementDaysApplied?: number
  /** Vencimento calculado pela conta com prazo. Ver `dueDate` no schema. */
  dueDate?: Date
}
```

E no corpo de `computeSnapshot`, o bloco do prazo:

```ts
    if (settlementDays != null) {
      snapshot.settlementDaysApplied = settlementDays

      // Prazo ZERO é "cai na hora": não gera vencimento. Sem esta guarda o
      // movimento nasceria `pending` com vencimento igual à data do lançamento,
      // invertendo o comportamento que a conta de prazo zero tem hoje.
      if (settlementDays > 0) {
        snapshot.dueDate = addDays(date, settlementDays)
      }
    }
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm run test:unit -- movement-rules`
Esperado: PASS nos testes de `computeSnapshot`. Os de `defaultStatus` e
`resolveStatusSource` continuam vermelhos — são a Tarefa 4.

- [ ] **Passo 5: Commit**

```bash
git add src/app/financial-movement/movement-rules.ts src/app/financial-movement/movement-rules.spec.ts
git commit -m "feat(movimento): computeSnapshot devolve dueDate no lugar da data prevista

Prazo zero deixa de gerar vencimento: com a regra nova (tem vencimento ->
pendente), gerar data igual a do lancamento faria a conta de prazo zero passar a
nascer pendente, invertendo o comportamento atual."
```

---

## Tarefa 4 — `defaultStatus` pela presença do vencimento (MIN-92)

**Files:**
- Modify: `src/app/financial-movement/movement-rules.ts:38-73`
- Test: `src/app/financial-movement/movement-rules.spec.ts`

**Interfaces:**
- Produces: `defaultStatus({ dueDate?: Date | null }): MovementStatus`. A
  assinatura antiga (`{ direction, account }`) deixa de existir.
- `resolveStatusSource` é removida.

- [ ] **Passo 1: Escrever os testes que falham**

Substitua o bloco de testes de `defaultStatus` por:

```ts
describe('defaultStatus', () => {
  it('com vencimento futuro nasce pendente', () => {
    expect(defaultStatus({ dueDate: new Date('2099-01-01T00:00:00.000Z') })).toBe(MovementStatus.Pending)
  })

  it('com vencimento JÁ PASSADO também nasce pendente', () => {
    // Vencer não é pagar. Só o dono sabe se pagou — e ele diz isso pelo
    // PATCH /:id/status, não pelo calendário.
    expect(defaultStatus({ dueDate: new Date('2020-01-01T00:00:00.000Z') })).toBe(MovementStatus.Pending)
  })

  it('sem vencimento nasce liquidado (à vista)', () => {
    expect(defaultStatus({})).toBe(MovementStatus.Settled)
  })

  it('vencimento nulo nasce liquidado', () => {
    expect(defaultStatus({ dueDate: null })).toBe(MovementStatus.Settled)
  })
})
```

E **apague** o `describe` inteiro de `resolveStatusSource`.

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm run test:unit -- movement-rules`
Esperado: FAIL de compilação — `defaultStatus` ainda exige `direction` e `account`.

- [ ] **Passo 3: Implementar**

Em `movement-rules.ts`, troque `defaultStatus` e apague `resolveStatusSource`
inteira (a função e o bloco de comentário acima dela):

```ts
/**
 * Status default: **tem vencimento → `pending`; não tem → `settled`**. Uma regra
 * só, sem olhar direção.
 *
 * Repare que a regra olha a PRESENÇA do vencimento, não se ele já passou. Uma
 * saída lançada hoje com vencimento de ontem nasce `pending` e aparece como
 * vencida — vencer não é pagar, e quem diz que pagou é o dono, pelo
 * `PATCH /:id/status`. Se a data mandasse, o bloco "Vencidos" do Fluxo de Caixa
 * nunca teria conteúdo.
 *
 * Entrada em conta `platform` com prazo mantém o comportamento de sempre: o
 * `computeSnapshot` gera o vencimento e ela nasce `pending`. Prazo zero não gera
 * vencimento, então nasce `settled`.
 */
export function defaultStatus (params: { dueDate?: Date | null }): MovementStatus {
  return params.dueDate != null ? MovementStatus.Pending : MovementStatus.Settled
}
```

Ajuste o import do arquivo: `MovementStatusSource` e `MovementDirection` podem
ficar sem uso depois da remoção — deixe o `lint` apontar e limpe.

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm run test:unit -- movement-rules`
Esperado: PASS nos testes de regra. Os use-cases ainda não compilam — chamam
`defaultStatus` com a assinatura velha e importam `resolveStatusSource`. É a
Tarefa 6 e a 7.

- [ ] **Passo 5: Commit**

```bash
git add src/app/financial-movement/movement-rules.ts src/app/financial-movement/movement-rules.spec.ts
git commit -m "feat(movimento): status nasce da presenca do vencimento

defaultStatus deixa de olhar direcao e conta: tem vencimento -> pendente, nao
tem -> liquidado. Saida com vencimento de ontem nasce pendente, porque vencer
nao e pagar.

resolveStatusSource sai junto. Ela existia porque um pendente sem data prevista
era inalcancavel pelo settler e chama-lo de auto era mentira; agora esse estado
nao nasce mais — sem vencimento o movimento nasce liquidado."
```

---

## Tarefa 5 — `resolveDueDate` e `shouldRecomputeStatus` (MIN-92)

**Files:**
- Modify: `src/app/financial-movement/movement-rules.ts` (acrescenta duas funções)
- Test: `src/app/financial-movement/movement-rules.spec.ts`

**Interfaces:**
- Produces:
  - `resolveDueDate({ informed?, computed?, stored?, storedWasComputed }): Date | undefined`
  - `shouldRecomputeStatus({ hadDueDate, hasDueDate, isManual, statusExplicitlyChanged, currentStatus }): boolean`

- [ ] **Passo 1: Escrever os testes que falham**

```ts
describe('resolveDueDate', () => {
  const informado = new Date('2026-07-19T00:00:00.000Z')
  const calculado = new Date('2026-07-31T00:00:00.000Z')
  const gravado = new Date('2026-07-10T00:00:00.000Z')

  it('o informado pelo dono ganha do calculado pela conta', () => {
    expect(resolveDueDate({ informed: informado, computed: calculado, storedWasComputed: false }))
      .toEqual(informado)
  })

  it('informar null limpa o vencimento, mesmo havendo gravado', () => {
    expect(resolveDueDate({ informed: null, stored: gravado, storedWasComputed: false }))
      .toBeUndefined()
  })

  it('sem informado, vale o calculado pela conta', () => {
    expect(resolveDueDate({ computed: calculado, stored: gravado, storedWasComputed: true }))
      .toEqual(calculado)
  })

  it('vencimento informado antes sobrevive quando a conta não calcula nada', () => {
    // Mover um boleto de uma conta bancária para outra não pode apagar a data
    // em que ele vence — o vencimento é do boleto, não da conta.
    expect(resolveDueDate({ stored: gravado, storedWasComputed: false }))
      .toEqual(gravado)
  })

  it('vencimento que veio de conta com prazo NÃO sobrevive à troca para conta sem prazo', () => {
    // Aqui a data era derivada do repasse. Sem repasse, ela não significa nada.
    expect(resolveDueDate({ stored: gravado, storedWasComputed: true }))
      .toBeUndefined()
  })

  it('sem nada, não há vencimento', () => {
    expect(resolveDueDate({ storedWasComputed: false })).toBeUndefined()
  })
})

describe('shouldRecomputeStatus', () => {
  const base = {
    hadDueDate: false,
    hasDueDate: false,
    isManual: false,
    statusExplicitlyChanged: false,
    currentStatus: MovementStatus.Settled,
  }

  it('recomputa quando o vencimento passa a existir', () => {
    expect(shouldRecomputeStatus({ ...base, hadDueDate: false, hasDueDate: true })).toBe(true)
  })

  it('recomputa quando o vencimento deixa de existir', () => {
    expect(shouldRecomputeStatus({
      ...base, hadDueDate: true, hasDueDate: false, currentStatus: MovementStatus.Pending,
    })).toBe(true)
  })

  it('NÃO recomputa quando o vencimento só muda de data', () => {
    // Corrigir a data de um boleto não pago não pode transformá-lo em pago.
    expect(shouldRecomputeStatus({
      ...base, hadDueDate: true, hasDueDate: true, currentStatus: MovementStatus.Pending,
    })).toBe(false)
  })

  it('NÃO recomputa o que o dono decidiu na mão', () => {
    expect(shouldRecomputeStatus({ ...base, hasDueDate: true, isManual: true })).toBe(false)
  })

  it('NÃO recomputa quando esta edição mexeu no status', () => {
    expect(shouldRecomputeStatus({ ...base, hasDueDate: true, statusExplicitlyChanged: true })).toBe(false)
  })

  it('NUNCA recomputa cancelado', () => {
    // Reverter `cancelled` é no-op e aplicar `settled` credita o líquido:
    // recomputar criaria saldo do nada.
    expect(shouldRecomputeStatus({
      ...base, hasDueDate: true, currentStatus: MovementStatus.Cancelled,
    })).toBe(false)
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm run test:unit -- movement-rules`
Esperado: FAIL com "resolveDueDate is not defined" e "shouldRecomputeStatus is not defined".

- [ ] **Passo 3: Implementar**

Acrescente em `movement-rules.ts`, logo depois de `computeSnapshot`:

```ts
/**
 * Qual vencimento vale no documento resultante, na ordem de precedência:
 *
 * 1. O que o dono informou nesta escrita (`null` = limpar, "é à vista agora").
 * 2. O calculado pela conta com prazo — segue a conta e a data do lançamento.
 * 3. O que já estava gravado, **desde que não tenha vindo de conta com prazo**.
 *
 * A condição do item 3 é a que mantém o boleto inteiro. Um vencimento informado
 * pelo dono pertence ao lançamento e sobrevive a qualquer troca de conta. Um
 * vencimento derivado de repasse pertence à conta antiga: quando o movimento sai
 * dela, a data deixa de significar alguma coisa e tem que sumir — é isso que faz
 * o recebível voltar a ser dinheiro em caixa.
 */
export function resolveDueDate (params: {
  informed?: Date | null
  computed?: Date
  stored?: Date
  storedWasComputed: boolean
}): Date | undefined {
  const { informed, computed, stored, storedWasComputed } = params

  if (informed !== undefined) return informed ?? undefined
  if (computed != null) return computed
  if (stored != null && !storedWasComputed) return stored

  return undefined
}

/**
 * O status acompanha o vencimento quando ele **passa a existir ou deixa de
 * existir** — nunca quando só muda de data.
 *
 * É o que fecha o P8 nos dois sentidos: mover um lançamento para conta
 * plataforma faz nascer vencimento e ele volta a `pending`; mover de volta apaga
 * o vencimento e ele volta a `settled`. E é o que protege o boleto vencido:
 * corrigir a data de vencimento de uma conta não paga não pode marcá-la como
 * paga.
 *
 * `manual` é soberano, `cancelled` nunca é recomputado (reverter cancelado é
 * no-op; aplicar liquidado credita o líquido — o saldo nasceria do nada), e uma
 * edição que mexeu no status explicitamente já disse o que queria.
 */
export function shouldRecomputeStatus (params: {
  hadDueDate: boolean
  hasDueDate: boolean
  isManual: boolean
  statusExplicitlyChanged: boolean
  currentStatus: MovementStatus | string
}): boolean {
  const { hadDueDate, hasDueDate, isManual, statusExplicitlyChanged, currentStatus } = params

  if (isManual || statusExplicitlyChanged) return false
  if (currentStatus === MovementStatus.Cancelled) return false

  return hadDueDate !== hasDueDate
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm run test:unit -- movement-rules`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/app/financial-movement/movement-rules.ts src/app/financial-movement/movement-rules.spec.ts
git commit -m "feat(movimento): regras puras de vencimento e de recomputo de status

resolveDueDate decide qual vencimento vale: informado > calculado pela conta >
gravado, este ultimo so quando nao veio de conta com prazo — e essa condicao e o
que impede que mover um boleto de conta apague a data em que ele vence.

shouldRecomputeStatus so age quando o vencimento passa a existir ou deixa de
existir, nunca quando muda de data."
```

---

## Tarefa 6 — Registro grava o vencimento (MIN-92)

**Files:**
- Modify: `src/app/financial-movement/use-cases/register-movement.use-case.ts:12-27,84-115`
- Test: `src/app/financial-movement/use-cases/register-movement.use-case.spec.ts`

**Interfaces:**
- Consumes: `computeSnapshot` (Tarefa 3), `defaultStatus` (Tarefa 4), `resolveDueDate` (Tarefa 5).
- Produces: `RegisterMovementInput.dueDate?: string | Date`.

- [ ] **Passo 1: Escrever os testes que falham**

Em `register-movement.use-case.spec.ts`, siga o padrão de mock já usado no
arquivo e acrescente:

```ts
it('saída com vencimento futuro nasce pendente e grava dueDate', async () => {
  const created = await registerWith({
    direction: MovementDirection.Out,
    grossValue: 2100,
    accountType: 'bank',
    dueDate: '2026-07-19T00:00:00.000Z',
  })

  expect(created.status).toBe(MovementStatus.Pending)
  expect(created.dueDate).toEqual(new Date('2026-07-19T00:00:00.000Z'))
  expect(created.statusSource).toBe(MovementStatusSource.Auto)
})

it('saída com vencimento JÁ PASSADO nasce pendente (vencida)', async () => {
  const created = await registerWith({
    direction: MovementDirection.Out,
    grossValue: 730,
    accountType: 'bank',
    dueDate: '2020-01-01T00:00:00.000Z',
  })

  expect(created.status).toBe(MovementStatus.Pending)
})

it('saída sem vencimento continua nascendo liquidada', async () => {
  const created = await registerWith({ direction: MovementDirection.Out, grossValue: 730, accountType: 'bank' })

  expect(created.status).toBe(MovementStatus.Settled)
  expect(created.dueDate).toBeUndefined()
})

it('entrada em conta plataforma mantém o comportamento: vencimento calculado e pendente', async () => {
  const created = await registerWith({
    direction: MovementDirection.In,
    grossValue: 1000,
    accountType: 'platform',
    feePercent: 10,
    settlementDays: 30,
    date: '2026-07-01T00:00:00.000Z',
  })

  expect(created.status).toBe(MovementStatus.Pending)
  expect(created.dueDate).toEqual(new Date('2026-07-31T00:00:00.000Z'))
  expect(created.settlementDaysApplied).toBe(30)
})

it('vencimento informado pelo dono ganha do calculado pela conta', async () => {
  const created = await registerWith({
    direction: MovementDirection.In,
    grossValue: 1000,
    accountType: 'platform',
    feePercent: 10,
    settlementDays: 30,
    date: '2026-07-01T00:00:00.000Z',
    dueDate: '2026-07-05T00:00:00.000Z',
  })

  expect(created.dueDate).toEqual(new Date('2026-07-05T00:00:00.000Z'))
})
```

Se ainda não existir um helper `registerWith` no arquivo, escreva-o montando o
input e os mocks de conta/categoria do jeito que os testes vizinhos já fazem, e
use-o também nos testes novos.

Atualize os testes existentes do arquivo que asseram `predictedReceiptDate` para
asserir `dueDate`.

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm run test:unit -- register-movement`
Esperado: FAIL — o use-case não compila (importa `resolveStatusSource`, que não
existe mais, e chama `defaultStatus` com a assinatura velha).

- [ ] **Passo 3: Implementar**

Na interface de entrada:

```ts
export interface RegisterMovementInput {
  direction: MovementDirection
  title: string
  grossValue: number
  date: string | Date
  /** Vencimento informado pelo dono. Em conta `platform`, o sistema calcula quando ausente. */
  dueDate?: string | Date
  accountId: string
  // ... resto inalterado
}
```

No import, troque `resolveStatusSource` por `resolveDueDate`:

```ts
import { computeSnapshot, defaultStatus, balanceImpact, resolveDueDate } from '../movement-rules'
```

E o bloco 3 do `execute` passa a ser:

```ts
        // 3. Cálculos de domínio.
        const date = new Date(input.date)
        const snapshot = computeSnapshot({
          direction: input.direction,
          grossValue: input.grossValue,
          date,
          account: account as any,
        })

        // Vencimento: o informado pelo dono manda; senão vale o calculado pela
        // conta com prazo. Sem nenhum dos dois, é à vista.
        const dueDate = resolveDueDate({
          informed: input.dueDate != null ? new Date(input.dueDate) : undefined,
          computed: snapshot.dueDate,
          storedWasComputed: false,
        })

        const status = input.status ?? defaultStatus({ dueDate })
        const now = new Date()

        // Nasce `auto`: o settler pode liquidá-lo por data. Só vira `manual` se
        // um humano mexer no status depois, pelo PATCH /:id/status. Um status
        // explícito aqui NÃO carimba manual de propósito — um front que reenvia o
        // formulário inteiro mandaria o status junto e travaria o settler.
        const statusSource = MovementStatusSource.Auto
```

E, no documento, a linha do campo:

```ts
        if (snapshot.feePercentApplied != null) doc.feePercentApplied = snapshot.feePercentApplied
        if (snapshot.settlementDaysApplied != null) doc.settlementDaysApplied = snapshot.settlementDaysApplied
        if (dueDate != null) doc.dueDate = dueDate
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm run test:unit -- register-movement`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/app/financial-movement/use-cases/register-movement.use-case.ts src/app/financial-movement/use-cases/register-movement.use-case.spec.ts
git commit -m "feat(movimento): registro aceita e grava o vencimento

Saida com vencimento nasce pendente e vai para o saldo previsto; sem vencimento
continua nascendo liquidada. Entrada de plataforma mantem exatamente o
comportamento atual, inclusive prazo zero nascendo liquidada."
```

---

## Tarefa 7 — Edição: vencimento e recompute nos dois sentidos (MIN-92)

**Files:**
- Modify: `src/app/financial-movement/use-cases/update-movement.use-case.ts:12-23,88-200`
- Test: `src/app/financial-movement/use-cases/update-movement.use-case.spec.ts`

**Interfaces:**
- Consumes: `resolveDueDate`, `shouldRecomputeStatus` (Tarefa 5), `defaultStatus` (Tarefa 4).
- Produces: `UpdateMovementInput.dueDate?: string | Date | null`.

- [ ] **Passo 1: Escrever os testes que falham**

Os dois primeiros são o P8, um para cada sentido:

```ts
it('P8 — mover de conta cash para conta plataforma devolve o lançamento para pendente', async () => {
  // Recebível de cartão lançado na conta errada: nasce liquidado em cash e o
  // dinheiro entra como caixa em mãos. Corrigir a conta tem que desfazer isso.
  const mov = storedMovement({
    direction: MovementDirection.In,
    status: MovementStatus.Settled,
    statusSource: MovementStatusSource.Auto,
    accountType: 'cash',
  })

  const updated = await updateWith(mov, { accountId: PLATFORM_ACCOUNT_ID })

  expect(updated.status).toBe(MovementStatus.Pending)
  expect(updated.dueDate).toEqual(new Date('2026-07-31T00:00:00.000Z'))
})

it('P8 — mover de volta para conta cash devolve o lançamento para liquidado', async () => {
  const mov = storedMovement({
    direction: MovementDirection.In,
    status: MovementStatus.Pending,
    statusSource: MovementStatusSource.Auto,
    accountType: 'platform',
    settlementDaysApplied: 30,
    dueDate: new Date('2026-07-31T00:00:00.000Z'),
  })

  const updated = await updateWith(mov, { accountId: CASH_ACCOUNT_ID })

  expect(updated.status).toBe(MovementStatus.Settled)
  expect(updated.dueDate).toBeUndefined()
})

it('editar o título de um boleto vencido não o transforma em pago', async () => {
  const mov = storedMovement({
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    statusSource: MovementStatusSource.Auto,
    accountType: 'bank',
    dueDate: new Date('2020-01-01T00:00:00.000Z'),
  })

  const updated = await updateWith(mov, { title: 'Fornecedor Embalagens (corrigido)' })

  expect(updated.status).toBe(MovementStatus.Pending)
  expect(updated.dueDate).toEqual(new Date('2020-01-01T00:00:00.000Z'))
})

it('corrigir a data de vencimento de um boleto não pago mantém pendente', async () => {
  const mov = storedMovement({
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    statusSource: MovementStatusSource.Auto,
    accountType: 'bank',
    dueDate: new Date('2026-09-20T00:00:00.000Z'),
  })

  const updated = await updateWith(mov, { dueDate: '2026-09-22T00:00:00.000Z' })

  expect(updated.status).toBe(MovementStatus.Pending)
  expect(updated.dueDate).toEqual(new Date('2026-09-22T00:00:00.000Z'))
})

it('limpar o vencimento (null) liquida o lançamento', async () => {
  const mov = storedMovement({
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    statusSource: MovementStatusSource.Auto,
    accountType: 'bank',
    dueDate: new Date('2026-09-20T00:00:00.000Z'),
  })

  const updated = await updateWith(mov, { dueDate: null })

  expect(updated.status).toBe(MovementStatus.Settled)
  expect(updated.dueDate).toBeUndefined()
})

it('mover um boleto entre contas bancárias preserva o vencimento informado', async () => {
  const mov = storedMovement({
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    statusSource: MovementStatusSource.Auto,
    accountType: 'bank',
    dueDate: new Date('2026-09-20T00:00:00.000Z'),
  })

  const updated = await updateWith(mov, { accountId: OTHER_BANK_ACCOUNT_ID })

  expect(updated.dueDate).toEqual(new Date('2026-09-20T00:00:00.000Z'))
  expect(updated.status).toBe(MovementStatus.Pending)
})

it('o que o dono liquidou na mão não volta para pendente ao trocar de conta', async () => {
  const mov = storedMovement({
    direction: MovementDirection.In,
    status: MovementStatus.Settled,
    statusSource: MovementStatusSource.Manual,
    accountType: 'cash',
  })

  const updated = await updateWith(mov, { accountId: PLATFORM_ACCOUNT_ID })

  expect(updated.status).toBe(MovementStatus.Settled)
})
```

Adapte `storedMovement` e `updateWith` aos helpers que o arquivo já usa, e
atualize os testes existentes que asseram `predictedReceiptDate`.

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm run test:unit -- update-movement`
Esperado: FAIL — o use-case não compila.

- [ ] **Passo 3: Implementar**

Na interface:

```ts
export interface UpdateMovementInput {
  title?: string
  grossValue?: number
  date?: string | Date
  /** `null` limpa o vencimento (passa a ser à vista). Ausente = não mexer. */
  dueDate?: string | Date | null
  paymentMethod?: string
  // ... resto inalterado
}
```

Import:

```ts
import { computeSnapshot, balanceImpact, defaultStatus, resolveDueDate, shouldRecomputeStatus } from '../movement-rules'
```

Troque todo o bloco que hoje vai do comentário "P1 — trocar de conta RECOMPUTA"
até a definição de `newStatus` (linhas 88 a 121) por:

```ts
        const accountChanged = changes.accountId != null && changes.accountId !== oldAccountId
        const isManual = mov.statusSource === MovementStatusSource.Manual

        // Status explícito no payload só "vence" quando REALMENTE muda o status.
        // Um front que reenvia o formulário inteiro no save manda o status ATUAL
        // junto — isso não pode ser lido como intenção de mexer no status.
        const statusExplicitlyChanged = changes.status != null && changes.status !== mov.status
```

O snapshot continua onde está (o `frozenFee` não muda). Depois dele, substitua o
bloco inteiro do `predictedReceiptDate` (linhas 144 a 156) e o do `statusSource`
(linhas 158 a 170) por:

```ts
        // Vencimento do documento resultante. `'dueDate' in changes` distingue
        // "não enviado" de "enviado null" — o null é como o dono diz que aquilo
        // passou a ser à vista.
        const storedWasComputed = mov.settlementDaysApplied != null
        const newDueDate = resolveDueDate({
          informed: 'dueDate' in changes
            ? (changes.dueDate == null ? null : new Date(changes.dueDate))
            : undefined,
          computed: snapshot.dueDate,
          stored: mov.dueDate != null ? new Date(mov.dueDate) : undefined,
          storedWasComputed,
        })

        // O status acompanha o vencimento só quando ele passa a existir ou deixa
        // de existir. É o que fecha o P8 nos dois sentidos sem transformar boleto
        // vencido em boleto pago.
        const recompute = shouldRecomputeStatus({
          hadDueDate: mov.dueDate != null,
          hasDueDate: newDueDate != null,
          isManual,
          statusExplicitlyChanged,
          currentStatus: mov.status,
        })

        const statusByRules = recompute ? defaultStatus({ dueDate: newDueDate }) : mov.status
        const newStatus = statusExplicitlyChanged ? changes.status! : statusByRules

        // Editar um campo inócuo NÃO tira o movimento do alcance do settler: só
        // carimba `manual` se ESTA edição mexeu no status.
        const statusSource = statusExplicitlyChanged
          ? MovementStatusSource.Manual
          : (mov.statusSource ?? MovementStatusSource.Auto)
```

E, no documento reconstruído, a linha do campo:

```ts
        if (snapshot.feePercentApplied != null) newDoc.feePercentApplied = snapshot.feePercentApplied
        if (snapshot.settlementDaysApplied != null) newDoc.settlementDaysApplied = snapshot.settlementDaysApplied
        if (newDueDate != null) newDoc.dueDate = newDueDate
```

A variável `dateChanged` fica sem uso — remova a declaração dela e deixe o lint
confirmar.

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm run test:unit -- update-movement`
Esperado: PASS, inclusive os dois testes do P8.

- [ ] **Passo 5: Commit**

```bash
git add src/app/financial-movement/use-cases/update-movement.use-case.ts src/app/financial-movement/use-cases/update-movement.use-case.spec.ts
git commit -m "fix(movimento): recomputo de status nos dois sentidos (fecha o P8)

Mover um lancamento para conta plataforma faz nascer vencimento e ele volta a
pendente; mover de volta apaga o vencimento e ele volta a liquidado. Antes so o
segundo sentido funcionava, e um recebivel de cartao lancado em conta cash
ficava contabilizado como caixa em maos para sempre.

O recomputo so age quando o vencimento passa a existir ou deixa de existir —
corrigir a data de um boleto nao pago continua deixando ele pendente."
```

---

## Tarefa 8 — Settler por vencimento, restrito a entrada de plataforma (MIN-92)

**Files:**
- Modify: `src/app/financial-movement/use-cases/settle-due-movements.use-case.ts:12-25`
- Test: `src/app/financial-movement/use-cases/settle-due-movements.int.spec.ts`

**Interfaces:**
- Consumes: campo `dueDate` gravado nas Tarefas 6 e 7.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('liquida entrada de conta plataforma vencida', async () => {
  await seedMovement({
    direction: MovementDirection.In,
    status: MovementStatus.Pending,
    accountType: 'platform',
    dueDate: new Date('2026-07-01T00:00:00.000Z'),
  })

  const result = await new SettleDueMovementsUseCase().execute({ env, now: new Date('2026-07-02T00:00:00.000Z') })

  expect(result.settled).toBe(1)
})

it('NÃO liquida saída vencida — vencer não é pagar', async () => {
  await seedMovement({
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    accountType: 'bank',
    dueDate: new Date('2026-07-01T00:00:00.000Z'),
  })

  const result = await new SettleDueMovementsUseCase().execute({ env, now: new Date('2026-07-02T00:00:00.000Z') })

  expect(result.settled).toBe(0)
})

it('NÃO liquida entrada a prazo de conta comum — ninguém garante que o cliente pagou', async () => {
  await seedMovement({
    direction: MovementDirection.In,
    status: MovementStatus.Pending,
    accountType: 'bank',
    dueDate: new Date('2026-07-01T00:00:00.000Z'),
  })

  const result = await new SettleDueMovementsUseCase().execute({ env, now: new Date('2026-07-02T00:00:00.000Z') })

  expect(result.settled).toBe(0)
})

it('NÃO liquida entrada de plataforma ainda não vencida', async () => {
  await seedMovement({
    direction: MovementDirection.In,
    status: MovementStatus.Pending,
    accountType: 'platform',
    dueDate: new Date('2026-08-01T00:00:00.000Z'),
  })

  const result = await new SettleDueMovementsUseCase().execute({ env, now: new Date('2026-07-02T00:00:00.000Z') })

  expect(result.settled).toBe(0)
})
```

Ajuste os testes que já existem no arquivo para semear `dueDate` em vez de
`predictedReceiptDate`.

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npm run test:int -- settle-due-movements`
Esperado: FAIL — nada é liquidado, porque o filtro procura `predictedReceiptDate`
e os documentos agora têm `dueDate`. O teste da saída passa por engano, pelo
mesmo motivo.

- [ ] **Passo 3: Implementar**

Troque o import e o `dueFilter`:

```ts
import { FinancialAccountType, MovementDirection, MovementStatus, MovementStatusSource } from 'mintly-lib'

/**
 * Critério do que o robô pode liquidar sozinho. Serve à varredura (fora da
 * transação) E à releitura dentro da sessão — tem que ser o MESMO nos dois
 * lugares, senão a releitura deixa de ser um guard.
 *
 * **Só entrada em conta `platform`.** É o único dinheiro que cai sozinho: o
 * repasse acontece na data, sem ninguém fazer nada. Um boleto vencido NÃO foi
 * pago — liquidá-lo automaticamente esvaziaria o bloco "Vencidos" do Fluxo de
 * Caixa e mostraria como pago algo que talvez não tenha sido. O tipo da conta
 * vem do extended reference do próprio movimento, então não precisa de join.
 *
 * `statusSource` AUSENTE casa com `$ne: 'manual'` — é assim que o backlog
 * anterior ao campo é tratado como `auto`.
 */
const dueFilter = (now: Date): Filter<Document> => ({
  status: MovementStatus.Pending,
  statusSource: { $ne: MovementStatusSource.Manual },
  direction: MovementDirection.In,
  'account.type': FinancialAccountType.Platform,
  dueDate: { $lte: now },
})
```

Atualize também o bloco de comentário da classe, que cita `predictedReceiptDate`.

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npm run test:int -- settle-due-movements`
Esperado: PASS nos quatro testes novos e nos existentes.

- [ ] **Passo 5: Commit**

```bash
git add src/app/financial-movement/use-cases/settle-due-movements.use-case.ts src/app/financial-movement/use-cases/settle-due-movements.int.spec.ts
git commit -m "feat(settler): liquida por vencimento, so entrada de conta plataforma

O repasse do iFood cai sozinho na data; o boleto do fornecedor nao se paga
sozinho. Se o robo liquidasse toda saida vencida, o bloco Vencidos do Fluxo de
Caixa nunca teria conteudo e o caixa mostraria como pago algo que talvez nao
tenha sido.

Entrada a prazo em conta comum (fiado, cheque pre) tambem fica de fora: ninguem
garante que o cliente pagou."
```

---

## Tarefa 9 — Índices por vencimento (MIN-92)

**Files:**
- Modify: `src/infrastructure/db/indices/financial-movements.ts:22`

- [ ] **Passo 1: Trocar o índice do settler e acrescentar o do fluxo de caixa**

```ts
  // Query do settler: entradas de conta plataforma vencidas, CROSS-TENANT (sem
  // restaurantId — o job varre todos os restaurantes do ambiente numa tacada).
  // A ordem dos campos segue a seletividade do filtro.
  await col.createIndex({ status: 1, direction: 1, 'account.type': 1, dueDate: 1 })

  // Fluxo de Caixa: pendentes por vencimento dentro do restaurante — projeção,
  // a receber/a pagar e lista de vencimentos saem todos daqui.
  await col.createIndex({ restaurantId: 1, status: 1, dueDate: 1 })
```

- [ ] **Passo 2: Rodar a suíte inteira**

Rode: `npm run test:ci`
Esperado: PASS, com cobertura ≥ 90% nas quatro métricas. Se algum teste de
integração ainda semeia `predictedReceiptDate`, ele falha aqui — corrija.

Rode: `npm run lint && npm run typecheck`
Esperado: sem erro. O índice velho `{ status: 1, predictedReceiptDate: 1 }` fica
órfão no banco; o passo de remoção é a Tarefa 10.

- [ ] **Passo 3: Commit**

```bash
git add src/infrastructure/db/indices/financial-movements.ts
git commit -m "feat(db): indices por vencimento para o settler e o fluxo de caixa"
```

---

## Tarefa 10 — Migração do vencimento (MIN-93)

**Branch:** `chore/20260929/backfill-due-date`

**Files:**
- Create: `scripts/movements/backfill-due-date.ts`
- Modify: `package.json` (script `db:backfill-due-date`)

**Interfaces:**
- Consumes: documentos gravados antes da Tarefa 1, com `predictedReceiptDate`.

- [ ] **Passo 1: Escrever o script**

```ts
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'

/**
 * Migração do vencimento (M1): `predictedReceiptDate` → `dueDate`.
 *
 * Sem ela, o backlog de pendentes fica invisível para a liquidação automática —
 * o filtro do settler procura `dueDate`, e campo ausente nunca casa.
 *
 * Idempotente: pode rodar quantas vezes quiser. Cross-tenant de propósito, como
 * o settler — o tenant é campo do documento, não banco. Lê `MONGO_ENV`, igual ao
 * `db:indices`.
 *
 * Uso: `MONGO_ENV=staging npm run db:backfill-due-date`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  if (!env) {
    throw new Error('MONGO_ENV é obrigatório (ex.: MONGO_ENV=staging npm run db:backfill-due-date).')
  }

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const movements = connection.getDatabase(env).collection('financial_movements')

    // 1. Renomeia onde ainda não existe `dueDate`. `$rename` preserva o valor e
    //    remove o campo antigo numa operação só.
    const renamed = await movements.updateMany(
      { predictedReceiptDate: { $exists: true }, dueDate: { $exists: false } },
      { $rename: { predictedReceiptDate: 'dueDate' } },
    )

    // 2. Sobra: documento que já tinha `dueDate` (gravado pela API nova) e ainda
    //    carrega o campo velho. O `dueDate` é a verdade; o resto é lixo.
    const cleaned = await movements.updateMany(
      { predictedReceiptDate: { $exists: true } },
      { $unset: { predictedReceiptDate: '' } },
    )

    // 3. O índice do settler antigo não serve a nenhuma query viva.
    const indexes = await movements.indexes()
    const staleIndex = indexes.find((i) => i.name === 'status_1_predictedReceiptDate_1')
    if (staleIndex?.name) await movements.dropIndex(staleIndex.name)

    console.log(`[${env}] renomeados: ${renamed.modifiedCount} | limpos: ${cleaned.modifiedCount} | indice antigo: ${staleIndex ? 'removido' : 'ausente'}`)
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha na migração do vencimento:', error)
  process.exit(1)
})
```

- [ ] **Passo 2: Registrar o script**

Em `package.json`, junto dos outros `db:`:

```json
    "db:backfill-due-date": "tsx scripts/movements/backfill-due-date.ts",
```

- [ ] **Passo 3: Rodar contra um banco local e conferir**

Semeie dois documentos à mão num Mongo local — um com `predictedReceiptDate` e
sem `dueDate`, outro com os dois — e rode:

```bash
MONGO_ENV=<seu-env-local> npm run db:backfill-due-date
```

Esperado: o primeiro passa a ter `dueDate` com a data que estava em
`predictedReceiptDate`; o segundo mantém o `dueDate` que já tinha e perde o campo
velho. Rode de novo: a segunda execução reporta zero em tudo — é a idempotência.

- [ ] **Passo 4: Commit**

```bash
git add scripts/movements/backfill-due-date.ts package.json
git commit -m "chore(db): migracao de predictedReceiptDate para dueDate

Idempotente e cross-tenant, no mesmo padrao do db:indices e do db:settle. Sem
ela o backlog de pendentes fica invisivel para a liquidacao automatica: o filtro
do settler procura dueDate e campo ausente nunca casa."
```

- [ ] **Passo 5: Fechar a fatia**

Rode a suíte inteira uma última vez, com a documentação e tudo mais na branch:

```bash
npm run lint && npm run typecheck && npm run test:ci
```

Esperado: PASS, cobertura ≥ 90%. Abra o PR para `staging` com os dois commits de
documentação (design e pendências) incluídos, e rode a migração no ambiente
depois do deploy.

---

## Self-review

**Cobertura da spec (M1).** Campo único de vencimento: Tarefa 1. Cálculo pela
conta com prazo: Tarefa 3. Status pela presença do vencimento: Tarefa 4. Regra do
vencimento que sobrevive ou não à troca de conta: Tarefa 5. Registro: Tarefa 6.
Recompute nos dois sentidos, fechando o P8: Tarefa 7. Settler restrito a entrada
de plataforma: Tarefa 8. Índices: Tarefa 9. Migração: Tarefa 10. Remoção do
`resolveStatusSource`, que a spec declara desnecessário: Tarefa 4.

**Consistência de tipos.** `MovementSnapshot.dueDate` (Tarefa 3) é o `computed` de
`resolveDueDate` (Tarefa 5), consumido em `register` (Tarefa 6) e `update`
(Tarefa 7). `defaultStatus({ dueDate })` tem a mesma assinatura nas Tarefas 4, 6 e
7. `shouldRecomputeStatus` só é chamada na Tarefa 7, com os cinco campos que a
Tarefa 5 define.

**Ponto de atenção para quem executa.** A Tarefa 2 deixa a suíte vermelha de
propósito, e ela só fica verde de novo na Tarefa 9. É o custo de um breaking
change de contrato — não tente "consertar" o vermelho fora da ordem das tarefas.

**Uma decisão que vale conferir na execução.** `resolveDueDate` usa
`settlementDaysApplied != null` como sinal de "este vencimento veio de conta com
prazo". É verdade para todo documento gravado pela API, mas um documento semeado
direto no banco com `dueDate` e sem `settlementDaysApplied` seria tratado como
vencimento informado pelo dono — e sobreviveria a uma troca de conta. O efeito é
benigno (a data continua lá) e a alternativa seria um campo só para marcar a
origem do vencimento, que não se paga.
