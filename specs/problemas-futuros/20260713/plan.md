# Problemas Futuros (P1/P3/P4/P5/P7) — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> checkbox (`- [ ]`) para rastreamento.

**Spec:** `MintlyApi/specs/problemas-futuros/20260713/design.md` (leia antes de começar)

**Goal:** Liquidar automaticamente por data os movimentos de conta plataforma, congelar o snapshot
de taxa/prazo na edição, fechar o CORS, tornar o tipo da conta imutável e fechar o tipo `Headers`.

**Architecture:** Regras puras (`movement-rules.ts`, `account-rules.ts`) sem Mongo; use-cases
transacionais em cima delas; um settler puro (`SettleDueMovementsUseCase`) disparado por script
agendado no GitHub Actions, sem rota HTTP e sem auth nova. Três mudanças de schema na MintlyLib
(duas *breaking*) que precisam ser publicadas antes da API consumi-las.

**Tech Stack:** TypeScript, Fastify 5, MongoDB driver 6 (sem ODM), Sapphire (validação), Vitest
(API), Jest (lib).

## Global Constraints

- **Dois repos.** `C:\Users\alexa\code\Mintly\MintlyLib` e `C:\Users\alexa\code\Mintly\MintlyApi`.
- **Antes de qualquer código:** `git checkout staging && git pull` **nos dois repos**. O MintlyLib
  está hoje numa branch `feat/MIN-66/...` desatualizada (2.3.0-preview vs 2.7.1-preview na staging).
- **Branch de trabalho:** `fix/20260713/problemas-futuros` nos dois repos (convenção
  `fix/<data>/<tema>`).
- **Idioma:** comentários e mensagens de commit em português; commits no padrão
  `tipo(escopo): descrição`.
- **Dinheiro** é `number` no domínio e `Decimal128` na borda de persistência. Nunca mudar isso.
- **Tenant:** `restaurantId` vem do JWT, nunca de header. A **única** exceção é o settler, que roda
  fora de request e é cross-tenant por natureza.
- **Cobertura:** threshold de 90% (lines/statements/branches/functions) no MintlyApi. `npm run
  test:ci` precisa passar.
- **Sapphire não tem `refine`/`superRefine`.** Regra cruzada que dependa de estado armazenado vai
  para o use-case/regra pura da API, nunca para o schema.
- **A MintlyLib precisa ser publicada antes da API poder consumir.** Tarefas 1–4 (lib) são um gate
  para as tarefas 6+ (API).

---

## Estrutura de arquivos

**MintlyLib** (`src/`)
- Modificar `core/data/financial/financial-movement-schema.ts` — enum `MovementStatusSource` +
  campo `statusSource` opcional.
- Modificar `core/data/financial/financial-account-schema.ts` — remover `type` do
  `financialAccountUpdateSchema`.
- Modificar `core/data/request/headers.ts` — fechar o tipo (remover index signature).
- Modificar `package.json` — adicionar script `test`.
- Testes: `core/data/financial/financial-movement-schema.spec.ts`,
  `core/data/financial/financial-account-schema.spec.ts`.

**MintlyApi** (`src/`)
- Modificar `app/financial-movement/movement-rules.ts` — `computeSnapshot` aceita taxa/prazo
  congelados.
- Criar `app/financial-movement/movement-status.ts` — `applyStatusTransition` compartilhada
  (troca de status + correção de saldo, guard-first).
- Modificar `app/financial-movement/use-cases/change-movement-status.use-case.ts` — usa a função
  compartilhada e carimba `manual`.
- Modificar `app/financial-movement/use-cases/register-movement.use-case.ts` — grava
  `statusSource: 'auto'`.
- Modificar `app/financial-movement/use-cases/update-movement.use-case.ts` — snapshot congelado +
  carimba `manual` só se o status mudar.
- Criar `app/financial-movement/use-cases/settle-due-movements.use-case.ts` — o settler.
- Modificar `infrastructure/db/indices/financial-movements.ts` — índice da query do settler.
- Criar `scripts/movements/settle-due.ts` + script `db:settle` no `package.json`.
- Criar `.github/workflows/settle.yml` — cron diário.
- Criar `core/config/cors-origins.ts` — allowlist pura.
- Modificar `infrastructure/server/build-server.ts` — usa a allowlist.
- Modificar `.env.example` — `CORS_ORIGINS`.
- Criar `app/financial-account/account-rules.ts` — regra pura de update (espelha `movement-rules.ts`).
- Modificar `app/financial-account/financial-account-controller.ts` — guard de update.

> **Desvio consciente da spec (P5):** a spec falava em `UpdateAccountUseCase`. Na exploração ficou
> claro que a regra é **pura** (não precisa de transação nem de escrita) e que o repo já tem o padrão
> certo para isso: `movement-rules.ts`. Então a regra vira `account-rules.ts` (pura, unit-testável) e
> o controller a chama depois de carregar a conta pelo repositório — reaproveitando o `CrudUseCase`
> (que já cuida do `audit` por dot-notation) em vez de reimplementá-lo. Mesmo resultado, menos código.

---

# PARTE A — MintlyLib

### Task 1: Preparar o repo da lib e destravar os testes

**Files:**
- Modify: `MintlyLib/package.json`

**Interfaces:**
- Produces: `npm test` executável na lib (hoje os `.spec.ts` existem mas nenhum script os roda).

- [ ] **Step 1: Ir para staging e atualizar**

```bash
cd /c/Users/alexa/code/Mintly/MintlyLib
git checkout staging
git pull
npm ci
git checkout -b fix/20260713/problemas-futuros
```

Esperado: branch nova a partir de uma staging atualizada (versão `2.7.1-preview` ou superior no
`package.json`).

- [ ] **Step 2: Adicionar o script de teste**

Em `MintlyLib/package.json`, dentro de `"scripts"`, adicione a linha `test` (mantendo as demais):

```json
"test": "jest",
```

- [ ] **Step 3: Rodar os testes existentes**

```bash
npm test
```

Esperado: PASS. As specs de schema já existem (`financial-account-schema.spec.ts`,
`financial-movement-schema.spec.ts` e outras) e nunca eram executadas.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(test): script test executa o jest (as specs existiam mas nunca rodavam)"
```

---

### Task 2: `statusSource` no schema de movimentação (P1)

**Files:**
- Modify: `MintlyLib/src/core/data/financial/financial-movement-schema.ts`
- Test: `MintlyLib/src/core/data/financial/financial-movement-schema.spec.ts`

**Interfaces:**
- Produces: `export enum MovementStatusSource { Auto = 'auto', Manual = 'manual' }` e o campo
  opcional `statusSource` em `financialMovementSchema`. A API importa ambos de `'mintly-lib'`.
- **Não** entra em `registerMovementSchema` nem em `updateMovementSchema`: é campo controlado pelo
  servidor, o client não pode enviá-lo (os objetos são estritos → enviar dá 400).

- [ ] **Step 1: Escrever o teste que falha**

Em `MintlyLib/src/core/data/financial/financial-movement-schema.spec.ts`, adicione ao final (ajuste
os imports do topo para incluir `MovementStatusSource`):

```ts
describe('statusSource (P1 - liquidação automática)', () => {
  it('aceita statusSource auto', () => {
    const doc = { ...validInMovement(), statusSource: MovementStatusSource.Auto }
    expect(financialMovementSchema.safeParse(doc).success).toBe(true)
  })

  it('aceita statusSource manual', () => {
    const doc = { ...validInMovement(), statusSource: MovementStatusSource.Manual }
    expect(financialMovementSchema.safeParse(doc).success).toBe(true)
  })

  it('aceita movimento sem statusSource (docs antigos - ausente vale como auto)', () => {
    const doc = validInMovement()
    expect(financialMovementSchema.safeParse(doc).success).toBe(true)
  })

  it('rejeita statusSource desconhecido', () => {
    const doc = { ...validInMovement(), statusSource: 'robot' }
    expect(financialMovementSchema.safeParse(doc).success).toBe(false)
  })

  it('rejeita statusSource no payload de registro (campo do servidor)', () => {
    const body = { ...validRegisterBody(), statusSource: MovementStatusSource.Manual }
    expect(registerMovementSchema.safeParse(body).success).toBe(false)
  })
})
```

> Se a spec ainda não tiver os helpers `validInMovement()` / `validRegisterBody()`, reaproveite os
> objetos válidos que já existem nos testes do arquivo (extraia-os para funções no topo do arquivo,
> sem mudar o comportamento dos testes existentes).

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx jest src/core/data/financial/financial-movement-schema.spec.ts
```

Esperado: FAIL — `MovementStatusSource` não existe (erro de compilação do ts-jest).

- [ ] **Step 3: Implementar**

Em `financial-movement-schema.ts`, após o enum `MovementOrigin`:

```ts
/**
 * Origem do status atual do movimento (P1 — liquidação automática).
 *  - `auto`: status definido pelo sistema (registro ou settler por data).
 *  - `manual`: um humano mexeu no status (PATCH /:id/status). Trava permanente:
 *    o settler NUNCA mais reavalia esse movimento — quem tem a palavra final é o dono.
 *
 * Campo AUSENTE é lido como `auto` (docs anteriores a este campo). É isso que faz
 * o backlog de pendentes vencidos liquidar na primeira rodada do settler.
 */
export enum MovementStatusSource {
  Auto = 'auto',
  Manual = 'manual',
}
```

E dentro de `baseMovementSchema`, logo abaixo de `status`:

```ts
  // Quem definiu o status atual (sistema vs humano). Opcional: docs antigos não têm.
  statusSource: s.type().enum(MovementStatusSource).optional(),
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx jest src/core/data/financial/financial-movement-schema.spec.ts
```

Esperado: PASS (todos os casos, incluindo a rejeição no `registerMovementSchema` — que passa de
graça porque o objeto é estrito).

- [ ] **Step 5: Commit**

```bash
git add src/core/data/financial/financial-movement-schema.ts src/core/data/financial/financial-movement-schema.spec.ts
git commit -m "feat(movimento): statusSource auto|manual para travar o settler (P1)"
```

---

### Task 3: `type` imutável no update de conta (P5) — BREAKING

**Files:**
- Modify: `MintlyLib/src/core/data/financial/financial-account-schema.ts`
- Test: `MintlyLib/src/core/data/financial/financial-account-schema.spec.ts`

**Interfaces:**
- Produces: `financialAccountUpdateSchema` **sem** o campo `type`. Como o objeto do Sapphire é
  estrito, mandar `type` num PATCH passa a ser rejeitado (400).

- [ ] **Step 1: Escrever o teste que falha**

Em `financial-account-schema.spec.ts`, adicione:

```ts
describe('financialAccountUpdateSchema — type imutável (P5)', () => {
  it('rejeita PATCH com type (o tipo da conta é imutável)', () => {
    const result = financialAccountUpdateSchema.safeParse({ type: 'platform' })
    expect(result.success).toBe(false)
  })

  it('continua aceitando PATCH de name', () => {
    expect(financialAccountUpdateSchema.safeParse({ name: 'Caixa novo' }).success).toBe(true)
  })

  it('continua aceitando PATCH de feePercent (a coerência com o tipo é validada na API)', () => {
    expect(financialAccountUpdateSchema.safeParse({ feePercent: 15 }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx jest src/core/data/financial/financial-account-schema.spec.ts
```

Esperado: FAIL no primeiro caso — hoje `type` é aceito.

- [ ] **Step 3: Implementar**

Em `financial-account-schema.ts`, no `financialAccountUpdateSchema`, **remova a linha do `type`** e
ajuste o comentário do bloco:

```ts
// 5. SCHEMA DE EDIÇÃO PARCIAL (PATCH / update)
// Por que um schema separado em vez de reaproveitar o de cima:
//  - O de criação é uma UNIÃO discriminada; união não tem .partial() no Sapphire.
//  - Aqui usamos um OBJETO achatado + .partial(): todo campo vira opcional, mas
//    o que for enviado é validado (ex.: feePercent 0..100).
//  - `type` NÃO está aqui de propósito (P5): o tipo da conta é IMUTÁVEL. Trocá-lo
//    permitiria criar uma conta `platform` sem taxa/prazo (estado que a criação
//    proíbe) e reescreveria o significado do histórico de movimentos, já que
//    defaultStatus/computeSnapshot decidem tudo pelo `type`. Errou o tipo? Inative
//    a conta e crie outra.
//  - A coerência platform ⇔ taxa/prazo num PATCH depende do tipo ARMAZENADO, que o
//    schema não conhece: é validada no lado da API (account-rules.ts).
//  - restaurantId, isDefault, saldos, history e audit ficam de fora: o objeto é
//    estrito, então enviá-los num PATCH é rejeitado.
export const financialAccountUpdateSchema = s.object({
  name: s.string(),
  status: s.type().enum(RecordStatus),
  feePercent: s.number().min(0).max(100),
  settlementDays: s.number().int().min(0),
}).partial()
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx jest src/core/data/financial/financial-account-schema.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/data/financial/financial-account-schema.ts src/core/data/financial/financial-account-schema.spec.ts
git commit -m "feat(conta)!: type sai do schema de update - tipo da conta e imutavel (P5)"
```

> O `!` no tipo do commit sinaliza breaking change.

---

### Task 4: Fechar o tipo `Headers` (P7) — BREAKING + publicar a lib

**Files:**
- Modify: `MintlyLib/src/core/data/request/headers.ts`
- Verify: `MintlyLib/src/core/client/request-config.ts`

**Interfaces:**
- Produces: `Headers = { env: string; authorization?: string }` — sem index signature.

- [ ] **Step 1: Fechar o tipo**

Substitua o conteúdo de `src/core/data/request/headers.ts`:

```ts
/**
 * Headers de contexto enviados em toda requisição à API.
 *
 * - `env` é **obrigatório**: seleciona o banco do ambiente (multi-ambiente por banco).
 * - `authorization` (Bearer token) aparece nas rotas protegidas — opcional porque
 *   rotas públicas (ex.: login) não o têm.
 *
 * Tipo FECHADO de propósito (P7): não existe index signature. O `restaurantId` era
 * campo morto — a API o deriva do JWT e sempre ignorou o header. Deixar a porta
 * aberta ("o tipo não modela, mas dá pra passar") só confundia. Quem é dono do dado
 * vem do token, ponto.
 */
export type Headers = {
  env: string
  authorization?: string
}
```

- [ ] **Step 2: Verificar quem quebrou**

```bash
npm run typecheck
```

Esperado: PASS. Se algum client (provavelmente `src/core/client/request-config.ts` ou
`http-base-client.ts`) montar headers extras e quebrar, ajuste **naquele arquivo** para usar um tipo
local em vez de afrouxar o `Headers` de volta.

- [ ] **Step 3: Rodar tudo**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Esperado: tudo PASS.

- [ ] **Step 4: Commit e PR**

```bash
git add -A
git commit -m "feat(headers)!: tipo fechado - restaurantId nao existe como header (P7)"
git push -u origin fix/20260713/problemas-futuros
gh pr create --base staging --title "fix(20260713): problemas futuros P1/P5/P7 (schemas)" --body "statusSource no movimento (P1), type imutavel no update de conta (P5), Headers fechado (P7). Breaking: P5 e P7."
```

- [ ] **Step 5: Merge e conferir a publicação**

Depois do merge na `staging`, o CI (`auto-version` + `publish`) bumpa a versão e publica no npm com
dist-tag `preview`. Confirme a versão publicada:

```bash
npm view mintly-lib dist-tags
```

Esperado: `preview` apontando para uma versão **maior** que `2.7.1-preview`. **Anote essa versão** —
a Task 5 depende dela.

---

# PARTE B — MintlyApi

### Task 5: Preparar o repo da API e consumir a lib nova

**Files:**
- Modify: `MintlyApi/package.json`

**Interfaces:**
- Consumes: a versão da lib publicada na Task 4.
- Produces: `MovementStatusSource` importável de `'mintly-lib'` dentro da API.

- [ ] **Step 1: Ir para staging e atualizar**

```bash
cd /c/Users/alexa/code/Mintly/MintlyApi
git checkout staging
git pull
git checkout -b fix/20260713/problemas-futuros
```

- [ ] **Step 2: Instalar a versão nova da lib**

Troque `<VERSAO>` pela versão anotada na Task 4:

```bash
npm install mintly-lib@<VERSAO>
```

- [ ] **Step 3: Verificar o que quebrou**

```bash
npm run typecheck
```

Esperado: pode FALHAR — o `financial-account-controller.ts` passa `financialAccountUpdateSchema` ao
`super`, e o schema mudou. Se o typecheck passar, ótimo (o cast `as any` do controller absorve).
Qualquer erro aqui será resolvido na Task 12; se for só ruído de tipo, siga.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): consome mintly-lib <VERSAO> (statusSource, type imutavel, headers)"
```

---

### Task 6: `computeSnapshot` aceita taxa/prazo congelados (P3)

**Files:**
- Modify: `MintlyApi/src/app/financial-movement/movement-rules.ts`
- Test: `MintlyApi/src/app/financial-movement/movement-rules.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AppliedFee { percent?: number; settlementDays?: number }
  export function computeSnapshot (params: {
    direction: MovementDirection
    grossValue: number
    date: Date
    account: AccountForRules
    fee?: AppliedFee   // quando presente, sobrepõe a taxa/prazo VIVOS da conta
  }): MovementSnapshot
  ```
  Chamadas existentes sem `fee` continuam funcionando (comportamento atual preservado).

- [ ] **Step 1: Escrever os testes que falham**

Em `movement-rules.spec.ts`, adicione:

```ts
describe('computeSnapshot com taxa congelada (P3)', () => {
  const platformAccount = { type: 'platform', feePercent: 20, settlementDays: 30 }

  it('usa a taxa congelada em vez da taxa viva da conta', () => {
    const snap = computeSnapshot({
      direction: MovementDirection.In,
      grossValue: 100,
      date: new Date('2026-01-10T00:00:00.000Z'),
      account: platformAccount,
      fee: { percent: 10, settlementDays: 5 },
    })

    expect(snap.feeValue).toBe(10)
    expect(snap.netValue).toBe(90)
    expect(snap.feePercentApplied).toBe(10)
    expect(snap.settlementDaysApplied).toBe(5)
    expect(snap.predictedReceiptDate).toEqual(new Date('2026-01-15T00:00:00.000Z'))
  })

  it('sem fee congelado, deriva da conta viva (comportamento do registro)', () => {
    const snap = computeSnapshot({
      direction: MovementDirection.In,
      grossValue: 100,
      date: new Date('2026-01-10T00:00:00.000Z'),
      account: platformAccount,
    })

    expect(snap.feeValue).toBe(20)
    expect(snap.netValue).toBe(80)
    expect(snap.feePercentApplied).toBe(20)
    expect(snap.settlementDaysApplied).toBe(30)
  })

  it('taxa congelada não se aplica a saída', () => {
    const snap = computeSnapshot({
      direction: MovementDirection.Out,
      grossValue: 100,
      date: new Date('2026-01-10T00:00:00.000Z'),
      account: platformAccount,
      fee: { percent: 10, settlementDays: 5 },
    })

    expect(snap.feeValue).toBe(0)
    expect(snap.netValue).toBe(100)
    expect(snap.feePercentApplied).toBeUndefined()
  })

  it('taxa congelada não se aplica a conta não-platform', () => {
    const snap = computeSnapshot({
      direction: MovementDirection.In,
      grossValue: 100,
      date: new Date('2026-01-10T00:00:00.000Z'),
      account: { type: 'bank' },
      fee: { percent: 10, settlementDays: 5 },
    })

    expect(snap.feeValue).toBe(0)
    expect(snap.netValue).toBe(100)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/app/financial-movement/movement-rules.spec.ts
```

Esperado: FAIL — `fee` não existe na assinatura.

- [ ] **Step 3: Implementar**

Em `movement-rules.ts`, substitua o bloco do `computeSnapshot` (linhas ~60-89):

```ts
/**
 * Taxa/prazo a aplicar. Vem do SNAPSHOT congelado no movimento (edição) ou é
 * derivada da conta viva quando ausente (registro, ou troca de conta).
 */
export interface AppliedFee {
  percent?: number
  settlementDays?: number
}

/**
 * Calcula fee/net e o snapshot de taxa/prazo. Taxa só se aplica a **entradas**
 * em conta `platform`. Saídas e contas não-platform: `feeValue = 0`,
 * `netValue = grossValue`, sem data prevista.
 *
 * `fee` (P3): quando informado, é a taxa/prazo CONGELADOS no lançamento — usados
 * na edição para que editar um campo inócuo (ex.: título) não re-precifique o
 * movimento com a taxa ATUAL da conta. Ausente: deriva da conta viva (registro).
 */
export function computeSnapshot (params: {
  direction: MovementDirection
  grossValue: number
  date: Date
  account: AccountForRules
  fee?: AppliedFee
}): MovementSnapshot {
  const { direction, grossValue, date, account, fee } = params
  const isPlatform = isPlatformAccount(account)

  if (direction === MovementDirection.In && isPlatform) {
    const percent = fee?.percent ?? account.feePercent
    const settlementDays = fee?.settlementDays ?? account.settlementDays

    const { feeValue, netValue } = computeFeeNet(grossValue, percent)
    const snapshot: MovementSnapshot = {
      feeValue,
      netValue,
      feePercentApplied: percent,
    }
    if (settlementDays != null) {
      snapshot.settlementDaysApplied = settlementDays
      snapshot.predictedReceiptDate = addDays(date, settlementDays)
    }
    return snapshot
  }

  return { feeValue: 0, netValue: grossValue }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/app/financial-movement/movement-rules.spec.ts
```

Esperado: PASS (inclusive os testes antigos — a chamada sem `fee` não mudou de comportamento).

- [ ] **Step 5: Commit**

```bash
git add src/app/financial-movement/movement-rules.ts src/app/financial-movement/movement-rules.spec.ts
git commit -m "feat(movimento): computeSnapshot aceita taxa/prazo congelados (P3)"
```

---

### Task 7: Edição congela o snapshot e não re-precifica (P3)

**Files:**
- Modify: `MintlyApi/src/app/financial-movement/use-cases/update-movement.use-case.ts:82-115`
- Test: `MintlyApi/src/app/financial-movement/use-cases/update-movement.use-case.spec.ts`

**Interfaces:**
- Consumes: `computeSnapshot({ ..., fee? })` da Task 6.
- Produces: `PATCH /:id` deixa de reescrever `netValue` quando a taxa da conta mudou.

- [ ] **Step 1: Escrever o teste que falha**

Adicione em `update-movement.use-case.spec.ts` (siga o padrão de mocks já usado no arquivo — se as
specs existentes forem de integração, escreva este caso como integração no
`movement-lifecycle.int.spec.ts` em vez disso):

```ts
it('editar o título NÃO re-precifica o movimento quando a taxa da conta mudou (P3)', async () => {
  // Movimento criado com feePercentApplied=10 (líquido 90 sobre bruto 100).
  // A conta HOJE cobra 20%. Editar só o título deve manter netValue=90.
  const movement = {
    _id: new ObjectId(),
    restaurantId: 'r1',
    direction: 'in',
    status: 'pending',
    title: 'Antigo',
    date: new Date('2026-01-10T00:00:00.000Z'),
    grossValue: 100,
    feeValue: 10,
    netValue: 90,
    feePercentApplied: 10,
    settlementDaysApplied: 5,
    account: { _id: String(accountId), name: 'iFood', type: 'platform' },
    category: { _id: String(categoryId), name: 'Vendas', type: 'revenue' },
    paymentMethod: 'pix',
    origin: 'manual',
    audit: { createdAt: new Date(), updatedAt: new Date() },
  }
  // conta viva agora com feePercent: 20
  const updated = await useCase.execute(String(movement._id), { title: 'Novo' }, ctx)

  expect(updated.title).toBe('Novo')
  expect(updated.netValue).toBe(90)          // NÃO 80
  expect(updated.feeValue).toBe(10)          // NÃO 20
  expect(updated.feePercentApplied).toBe(10) // snapshot preservado
})

it('trocar a CONTA do movimento re-precifica com a taxa da conta nova (P3 - exceção)', async () => {
  const updated = await useCase.execute(movementId, { accountId: String(outraContaPlatform20) }, ctx)

  expect(updated.feePercentApplied).toBe(20)
  expect(updated.netValue).toBe(80)
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/app/financial-movement/use-cases/update-movement.use-case.spec.ts
```

Esperado: FAIL — hoje `netValue` vira 80 (re-precificou com a taxa atual).

- [ ] **Step 3: Implementar**

Em `update-movement.use-case.ts`, substitua a linha 85 (`const snapshot = computeSnapshot({...})`)
por:

```ts
        // P3 — snapshot congelado: a edição reaproveita a taxa/prazo gravados no
        // movimento, para que editar um campo inócuo (ex.: título) não re-precifique
        // o líquido com a taxa ATUAL da conta. EXCEÇÃO: se o usuário TROCOU a conta,
        // não existe snapshot aplicável à conta nova — vale a taxa viva dela.
        const accountChanged = changes.accountId != null && changes.accountId !== oldAccountId
        const frozenFee = accountChanged
          ? undefined
          : {
              percent: mov.feePercentApplied != null ? num(mov.feePercentApplied) : undefined,
              settlementDays: mov.settlementDaysApplied != null ? Number(mov.settlementDaysApplied) : undefined,
            }

        const snapshot = computeSnapshot({
          direction: direction as any,
          grossValue: newGross,
          date: newDate,
          account: account as any,
          fee: frozenFee,
        })
```

E, no `newDoc` (após a linha `status: newStatus,`), preserve a origem do status — carimbando
`manual` **apenas** se esta edição mudou o status:

```ts
          // P1 — statusSource: editar um campo inócuo NÃO tira o movimento do settler.
          // Só carimba `manual` se ESTA edição mexeu no status (ação humana explícita).
          statusSource: (changes.status != null && changes.status !== mov.status)
            ? MovementStatusSource.Manual
            : (mov.statusSource ?? MovementStatusSource.Auto),
```

Adicione ao import do topo: `import { financialMovementSchema, MovementStatus, MovementStatusSource } from 'mintly-lib'`.

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/app/financial-movement/use-cases/update-movement.use-case.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/financial-movement/use-cases/update-movement.use-case.ts src/app/financial-movement/use-cases/update-movement.use-case.spec.ts
git commit -m "fix(movimento): edicao congela o snapshot de taxa/prazo (P3)"
```

---

### Task 8: Registro grava `statusSource: 'auto'` (P1)

**Files:**
- Modify: `MintlyApi/src/app/financial-movement/use-cases/register-movement.use-case.ts:84-99`
- Test: `MintlyApi/src/app/financial-movement/use-cases/register-movement.use-case.spec.ts`

**Interfaces:**
- Produces: todo movimento novo nasce com `statusSource: 'auto'` no documento persistido.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('grava statusSource auto no registro (P1)', async () => {
  const created = await useCase.execute(validInput, ctx)
  expect(created.statusSource).toBe('auto')
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/app/financial-movement/use-cases/register-movement.use-case.spec.ts
```

Esperado: FAIL — `statusSource` é `undefined`.

- [ ] **Step 3: Implementar**

Em `register-movement.use-case.ts`, no objeto `doc` (linha ~88), logo depois de `status,`:

```ts
          // P1 — nasce `auto`: o settler pode liquidá-lo por data. Só vira `manual`
          // se um humano mexer no status depois (PATCH /:id/status).
          statusSource: MovementStatusSource.Auto,
```

E no import: `import { financialMovementSchema, MovementDirection, MovementOrigin, MovementStatusSource } from 'mintly-lib'`.

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/app/financial-movement/use-cases/register-movement.use-case.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/financial-movement/use-cases/register-movement.use-case.ts src/app/financial-movement/use-cases/register-movement.use-case.spec.ts
git commit -m "feat(movimento): registro grava statusSource auto (P1)"
```

---

### Task 9: `applyStatusTransition` compartilhada + carimbo `manual`

**Files:**
- Create: `MintlyApi/src/app/financial-movement/movement-status.ts`
- Create: `MintlyApi/src/app/financial-movement/movement-status.spec.ts`
- Modify: `MintlyApi/src/app/financial-movement/use-cases/change-movement-status.use-case.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StatusTransitionParams {
    movements: Collection<any>
    accounts: Collection<any>
    movement: any            // doc JÁ lido dentro da sessão
    newStatus: string
    actor: string            // ctx.userId ?? 'system'
    statusSource: MovementStatusSource
    session: ClientSession
    now: Date
  }
  export async function applyStatusTransition (p: StatusTransitionParams): Promise<void>
  ```
- Consumida pela Task 10 (settler) e pelo `ChangeMovementStatusUseCase`.

**Por que existe:** sem ela, a regra "reverte o impacto do status antigo + aplica o do novo" viveria
duplicada no `ChangeMovementStatusUseCase` e no settler — e divergiria na primeira manutenção.

- [ ] **Step 1: Escrever o teste que falha**

Crie `movement-status.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { MovementStatusSource } from 'mintly-lib'
import { applyStatusTransition } from './movement-status'
import { ConflictError } from '../../core/errors/auth/conflict-error'

const movementDoc = () => ({
  _id: new ObjectId(),
  restaurantId: 'r1',
  direction: 'in',
  status: 'pending',
  grossValue: 100,
  netValue: 90,
  account: { _id: new ObjectId().toString(), name: 'iFood', type: 'platform' },
})

describe('applyStatusTransition', () => {
  it('atualiza o doc com guard de status e move o saldo de predicted para available', async () => {
    const mov = movementDoc()
    const movements = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } as any
    const accounts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } as any

    await applyStatusTransition({
      movements,
      accounts,
      movement: mov,
      newStatus: 'settled',
      actor: 'system',
      statusSource: MovementStatusSource.Auto,
      session: {} as any,
      now: new Date('2026-07-13T00:00:00.000Z'),
    })

    // guard-first: o filtro do updateOne exige o status ANTIGO (idempotência).
    const filter = movements.updateOne.mock.calls[0][0]
    expect(filter).toMatchObject({ _id: mov._id, restaurantId: 'r1', status: 'pending' })

    // duas escritas de saldo: reverte o predicted, aplica o available.
    expect(accounts.updateOne).toHaveBeenCalledTimes(2)
  })

  it('aborta (ConflictError) se outro processo já mudou o status - não mexe no saldo', async () => {
    const movements = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) } as any
    const accounts = { updateOne: vi.fn() } as any

    await expect(applyStatusTransition({
      movements,
      accounts,
      movement: movementDoc(),
      newStatus: 'settled',
      actor: 'system',
      statusSource: MovementStatusSource.Auto,
      session: {} as any,
      now: new Date(),
    })).rejects.toBeInstanceOf(ConflictError)

    expect(accounts.updateOne).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/app/financial-movement/movement-status.spec.ts
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/app/financial-movement/movement-status.ts`:

```ts
import { Collection, ObjectId, ClientSession } from 'mongodb'
import { MovementStatusSource } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { balanceImpact } from './movement-rules'
import { applyBalanceImpact } from './movement-balance'

const num = (v: any): number => Number((v ?? 0).toString())

export interface StatusTransitionParams {
  movements: Collection<any>
  accounts: Collection<any>
  /** Documento JÁ lido dentro da sessão. */
  movement: any
  newStatus: string
  /** Quem está agindo: `ctx.userId` ou 'system' (settler). */
  actor: string
  statusSource: MovementStatusSource
  session: ClientSession
  now: Date
}

/**
 * Troca o status de uma movimentação e corrige o saldo da conta na MESMA
 * transação: **reverte o impacto do status antigo + aplica o do novo**.
 * Fonte única dessa regra — usada pelo PATCH /:id/status (humano) e pelo
 * settler por data (P1).
 *
 * **Guard-first (idempotência):** o `updateOne` do movimento vem ANTES das
 * escritas de saldo e filtra pelo status ANTIGO. Se outro processo já tiver
 * mudado o status (duas rodadas concorrentes do settler, ou o dono mexendo ao
 * mesmo tempo), o filtro não casa, lançamos e a transação aborta — sem ter
 * tocado no saldo. A ordem inversa (saldo primeiro) causaria drift.
 */
export async function applyStatusTransition (p: StatusTransitionParams): Promise<void> {
  const { movements, accounts, movement, newStatus, actor, statusSource, session, now } = p

  const oldStatus = String(movement.status)
  const restaurantId = movement.restaurantId as string | undefined

  const res = await movements.updateOne(
    { _id: movement._id, restaurantId, status: oldStatus },
    {
      $set: {
        status: newStatus,
        statusSource,
        'audit.updatedAt': now,
        'audit.updatedBy': actor,
      },
      $push: {
        history: { at: now, by: actor, action: `status:${oldStatus}->${newStatus}` },
      } as any,
    },
    { session },
  )

  if (res.matchedCount === 0) {
    throw new ConflictError('O status da movimentação mudou concorrentemente; a operação foi abortada.')
  }

  const gross = num(movement.grossValue)
  const net = num(movement.netValue)
  const accountId = new ObjectId(String(movement.account._id))

  const oldImpact = balanceImpact({ direction: movement.direction, status: oldStatus as any, grossValue: gross, netValue: net })
  const newImpact = balanceImpact({ direction: movement.direction, status: newStatus as any, grossValue: gross, netValue: net })

  await applyBalanceImpact(accounts, accountId, restaurantId, oldImpact, -1, session, now)
  await applyBalanceImpact(accounts, accountId, restaurantId, newImpact, 1, session, now)
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/app/financial-movement/movement-status.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Refatorar o `ChangeMovementStatusUseCase` para usar a função**

Substitua o corpo do `withTransaction` em `change-movement-status.use-case.ts` (linhas 35-74) por:

```ts
      await session.withTransaction(async () => {
        const movements = db.collection('financial_movements')
        const accounts = db.collection('financial_accounts')

        const mov = await movements.findOne(
          { _id: new ObjectId(movementId), restaurantId: ctx.restaurantId },
          { session },
        )
        if (!mov) throw new NotFoundError(Resource.FinancialMovement, movementId)

        if (String(mov.status) === newStatus) {
          updated = movementFromStorage(mov as any)
          return
        }

        // P1 — ação HUMANA carimba `manual`: trava permanente, o settler nunca mais
        // reavalia este movimento por data. Quem tem a palavra final é o dono.
        await applyStatusTransition({
          movements,
          accounts,
          movement: mov,
          newStatus,
          actor: ctx.userId ?? 'system',
          statusSource: MovementStatusSource.Manual,
          session,
          now: new Date(),
        })

        updated = movementFromStorage({ ...mov, status: newStatus, statusSource: MovementStatusSource.Manual } as any)
      })
```

Ajuste os imports do arquivo: remova `balanceImpact`/`applyBalanceImpact` (agora vivem na função
compartilhada) e adicione:

```ts
import { MovementStatus, MovementStatusSource } from 'mintly-lib'
import { applyStatusTransition } from '../movement-status'
```

- [ ] **Step 6: Adicionar o teste do carimbo `manual`**

Em `change-movement-status.use-case.spec.ts`:

```ts
it('carimba statusSource manual (trava o settler) - P1', async () => {
  const updated = await useCase.execute(movementId, 'settled', ctx)
  expect(updated.statusSource).toBe('manual')
})
```

- [ ] **Step 7: Rodar toda a suíte do módulo**

```bash
npx vitest run src/app/financial-movement
```

Esperado: PASS (incluindo as specs de integração do ciclo de vida).

- [ ] **Step 8: Commit**

```bash
git add src/app/financial-movement
git commit -m "refactor(movimento): applyStatusTransition compartilhada + PATCH status carimba manual (P1)"
```

---

### Task 10: O settler (P1)

**Files:**
- Create: `MintlyApi/src/app/financial-movement/use-cases/settle-due-movements.use-case.ts`
- Create: `MintlyApi/src/app/financial-movement/use-cases/settle-due-movements.int.spec.ts`
- Modify: `MintlyApi/src/infrastructure/db/indices/financial-movements.ts`

**Interfaces:**
- Consumes: `applyStatusTransition` (Task 9).
- Produces:
  ```ts
  export interface SettleDueResult { settled: number; failed: number }
  export class SettleDueMovementsUseCase {
    execute (params: { env: string; now?: Date }): Promise<SettleDueResult>
  }
  ```
  **Puro**: não conhece Fastify, header, nem `RequestContext`. É isso que permite virar Lambda depois.

- [ ] **Step 1: Escrever o teste de integração que falha**

Crie `settle-due-movements.int.spec.ts` usando os helpers já existentes
(`tests/helpers/in-memory-mongo.ts`), no mesmo estilo do `movement-lifecycle.int.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { startInMemoryMongo, clearAllDatabases, stopInMemoryMongo } from '../../../../tests/helpers/in-memory-mongo'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { SettleDueMovementsUseCase } from './settle-due-movements.use-case'
import { toDecimal128 } from '../../../core/money/money'

const ENV = 'test'
const RESTAURANT = 'r1'

describe('SettleDueMovementsUseCase (P1)', () => {
  beforeAll(async () => { await startInMemoryMongo() })
  afterAll(async () => { await stopInMemoryMongo() })
  beforeEach(async () => { await clearAllDatabases() })

  const db = () => MongoDBConnection.getInstance().getDatabase(ENV)

  async function seed (movement: Record<string, any>) {
    const accountId = new ObjectId()
    await db().collection('financial_accounts').insertOne({
      _id: accountId,
      restaurantId: RESTAURANT,
      name: 'iFood',
      type: 'platform',
      status: 'active',
      isDefault: false,
      feePercent: 10,
      settlementDays: 5,
      availableBalance: toDecimal128(0),
      predictedBalance: toDecimal128(90),
      audit: { createdAt: new Date(), updatedAt: new Date() },
    })

    const movId = new ObjectId()
    await db().collection('financial_movements').insertOne({
      _id: movId,
      restaurantId: RESTAURANT,
      direction: 'in',
      title: 'Venda iFood',
      status: 'pending',
      date: new Date('2026-01-01T00:00:00.000Z'),
      grossValue: toDecimal128(100),
      feeValue: toDecimal128(10),
      netValue: toDecimal128(90),
      feePercentApplied: 10,
      settlementDaysApplied: 5,
      predictedReceiptDate: new Date('2026-01-06T00:00:00.000Z'),
      account: { _id: String(accountId), name: 'iFood', type: 'platform' },
      category: { _id: String(new ObjectId()), name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
      ...movement,
    })

    return { accountId, movId }
  }

  const balances = async (accountId: ObjectId) => {
    const acc = await db().collection('financial_accounts').findOne({ _id: accountId })
    return {
      available: Number(acc!.availableBalance.toString()),
      predicted: Number(acc!.predictedBalance.toString()),
    }
  }

  const NOW = new Date('2026-07-13T00:00:00.000Z')

  it('liquida o pendente vencido e move o dinheiro de predicted para available', async () => {
    const { accountId, movId } = await seed({ statusSource: 'auto' })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 1, failed: 0 })

    const mov = await db().collection('financial_movements').findOne({ _id: movId })
    expect(mov!.status).toBe('settled')

    expect(await balances(accountId)).toEqual({ available: 90, predicted: 0 })
  })

  it('trata statusSource AUSENTE como auto (destrava o backlog antigo)', async () => {
    const { accountId } = await seed({})  // sem statusSource

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result.settled).toBe(1)
    expect(await balances(accountId)).toEqual({ available: 90, predicted: 0 })
  })

  it('IGNORA movimento marcado como manual (o dono disse que não recebeu)', async () => {
    const { accountId, movId } = await seed({ statusSource: 'manual' })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 0, failed: 0 })

    const mov = await db().collection('financial_movements').findOne({ _id: movId })
    expect(mov!.status).toBe('pending')
    expect(await balances(accountId)).toEqual({ available: 0, predicted: 90 })
  })

  it('NÃO liquida quem ainda não venceu', async () => {
    await seed({ statusSource: 'auto', predictedReceiptDate: new Date('2026-12-31T00:00:00.000Z') })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result.settled).toBe(0)
  })

  it('é IDEMPOTENTE: rodar duas vezes não duplica saldo', async () => {
    const { accountId } = await seed({ statusSource: 'auto' })

    await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })
    const second = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(second).toEqual({ settled: 0, failed: 0 })
    expect(await balances(accountId)).toEqual({ available: 90, predicted: 0 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/app/financial-movement/use-cases/settle-due-movements.int.spec.ts
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o settler**

Crie `settle-due-movements.use-case.ts`:

```ts
import { MovementStatus, MovementStatusSource } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { applyStatusTransition } from '../movement-status'

export interface SettleDueResult {
  settled: number
  failed: number
}

/**
 * Liquidação automática por data (P1). Movimentos de conta `platform` nascem
 * `pending` (saldo "a receber") e, até aqui, NUNCA saíam de lá sozinhos: o
 * `predictedReceiptDate` era gravado e ninguém o lia. Resultado: o saldo
 * disponível subestimava o caixa real indefinidamente.
 *
 * Este use-case é **puro de infraestrutura de request**: não conhece Fastify,
 * header nem RequestContext — recebe o `env` e trabalha. É o que permite chamá-lo
 * de um script agendado hoje e de uma Lambda amanhã, sem reescrever nada.
 *
 * **Cross-tenant de propósito.** O tenant (`restaurantId`) é campo do documento,
 * não banco: uma única query por ambiente pega os movimentos de TODOS os
 * restaurantes. Não existe "enumerar tenants". É a única operação da API que roda
 * sem `restaurantId` — e roda fora de request, nunca a partir de um token.
 *
 * **Uma transação por movimento**, não uma gigante: um documento problemático não
 * pode derrubar a rodada inteira nem prender o lock do banco por minutos.
 */
export class SettleDueMovementsUseCase {
  async execute (params: { env: string; now?: Date }): Promise<SettleDueResult> {
    const now = params.now ?? new Date()
    const connection = MongoDBConnection.getInstance()
    const db = connection.getDatabase(params.env)

    const due = await db.collection('financial_movements').find({
      status: MovementStatus.Pending,
      // Campo AUSENTE casa com $ne: 'manual' — é assim que o backlog antigo
      // (anterior ao campo) é tratado como `auto` e liquida na primeira rodada.
      statusSource: { $ne: MovementStatusSource.Manual },
      predictedReceiptDate: { $lte: now },
    }).toArray()

    let settled = 0
    let failed = 0

    for (const movement of due) {
      const session = connection.getClient().startSession()
      try {
        await session.withTransaction(async () => {
          await applyStatusTransition({
            movements: db.collection('financial_movements'),
            accounts: db.collection('financial_accounts'),
            movement,
            newStatus: MovementStatus.Settled,
            actor: 'system',
            statusSource: MovementStatusSource.Auto,
            session,
            now,
          })
        })
        settled++
      } catch (error) {
        // Um movimento que falha (conta apagada, corrida com o dono) não pode
        // abortar a rodada dos outros. Loga e segue; o próximo run tenta de novo.
        failed++
        console.error(`[settler] falha ao liquidar ${String(movement._id)} (env=${params.env}):`, error)
      } finally {
        await session.endSession()
      }
    }

    return { settled, failed }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/app/financial-movement/use-cases/settle-due-movements.int.spec.ts
```

Esperado: PASS nos 5 casos.

- [ ] **Step 5: Adicionar o índice da query do settler**

Em `src/infrastructure/db/indices/financial-movements.ts`, dentro de `ensure`, ao final:

```ts
  // Query do settler (P1): pendentes vencidos, CROSS-TENANT (sem restaurantId —
  // o job varre todos os restaurantes do ambiente numa tacada).
  await col.createIndex({ status: 1, predictedReceiptDate: 1 })
```

- [ ] **Step 6: Commit**

```bash
git add src/app/financial-movement/use-cases/settle-due-movements.use-case.ts src/app/financial-movement/use-cases/settle-due-movements.int.spec.ts src/infrastructure/db/indices/financial-movements.ts
git commit -m "feat(movimento): settler liquida pendentes vencidos por data (P1)"
```

---

### Task 11: Script `db:settle` e cron do GitHub Actions (P1)

**Files:**
- Create: `MintlyApi/scripts/movements/settle-due.ts`
- Create: `MintlyApi/.github/workflows/settle.yml`
- Modify: `MintlyApi/package.json`

**Interfaces:**
- Consumes: `SettleDueMovementsUseCase` (Task 10) e `APP_DB` de
  `src/app/environment/env-allowlist.ts`.
- Produces: `npm run db:settle`.

- [ ] **Step 1: Criar o script**

Crie `scripts/movements/settle-due.ts` (espelha `scripts/app/seed-valid-envs.ts`):

```ts
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../../src/app/environment/env-allowlist'
import { SettleDueMovementsUseCase } from '../../src/app/financial-movement/use-cases/settle-due-movements.use-case'

/**
 * Liquidação automática por data (P1): roda o settler para TODOS os ambientes
 * listados em `app.valid_environments`.
 *
 * Uso: `npm run db:settle` (lê as vars de conexão do Mongo). Idempotente — pode
 * repetir sem duplicar saldo. Agendado 1x/dia pelo workflow `settle.yml`.
 *
 * Por que um script direto no banco, e não uma rota HTTP: um settler exposto por
 * HTTP exigiria um segundo mecanismo de auth (segredo) ou um usuário de sistema —
 * e este obrigaria a afrouxar a invariante "todo token tem dono" para atender um
 * robô. O `db:indices` já roda assim no deploy; este segue o mesmo caminho.
 */
async function main (): Promise<void> {
  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const envs = await connection
      .getDatabase(APP_DB)
      .collection<{ name: string }>('valid_environments')
      .find({}, { projection: { name: 1 } })
      .toArray()

    if (envs.length === 0) {
      console.warn(`Nenhum ambiente em ${APP_DB}.valid_environments — nada a liquidar. Rode 'npm run db:seed-envs' primeiro.`)
      return
    }

    const useCase = new SettleDueMovementsUseCase()

    for (const { name } of envs) {
      const result = await useCase.execute({ env: name })
      console.log(`[${name}] liquidados: ${result.settled} | falhas: ${result.failed}`)

      // Falha em liquidar é anomalia (conta apagada, corrida) — o exit code != 0
      // faz o workflow ficar vermelho em vez de sumir num log que ninguém lê.
      if (result.failed > 0) process.exitCode = 1
    }
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha na liquidação automática:', error)
  process.exit(1)
})
```

- [ ] **Step 2: Registrar o script no package.json**

Em `MintlyApi/package.json`, em `"scripts"`, depois de `"db:seed-envs"`:

```json
"db:settle": "tsx scripts/movements/settle-due.ts"
```

- [ ] **Step 3: Verificar que compila**

```bash
npm run typecheck && npm run lint
```

Esperado: PASS.

- [ ] **Step 4: Criar o workflow agendado**

Crie `.github/workflows/settle.yml`:

```yaml
---
name: Settle Due Movements

# Liquidação automática por data (P1). Roda 1x/dia às 06:00 UTC (03:00 BRT):
# movimentos `pending` de conta plataforma cuja data prevista de recebimento
# venceu passam a `settled`, migrando o dinheiro de predictedBalance para
# availableBalance. Idempotente — rodar duas vezes não duplica saldo.
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch: {}

jobs:
  settle:
    runs-on: ubuntu-latest
    env:
      MONGODB_HOSTS: ${{ secrets.MONGODB_HOSTS }}
      MONGODB_USER: ${{ secrets.MONGODB_USER }}
      MONGODB_PASSWORD: ${{ secrets.MONGODB_PASSWORD }}
      MONGODB_REPLICA_SET: ${{ secrets.MONGODB_REPLICA_SET }}
      MONGODB_AUTH_SOURCE: ${{ secrets.MONGODB_AUTH_SOURCE }}
      MONGODB_TLS: ${{ secrets.MONGODB_TLS }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: staging

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Install
        run: npm ci

      - name: Settle due movements
        run: npm run db:settle
```

> **Confira os nomes dos secrets** contra `.github/workflows/deploy.yml` (linhas ~60-65) antes de
> commitar. Se o repo tiver `yamllint` no CI, rode-o: `npx yamllint .github/workflows/settle.yml`.

- [ ] **Step 5: Commit**

```bash
git add scripts/movements/settle-due.ts package.json .github/workflows/settle.yml
git commit -m "feat(settler): script db:settle e cron diario do GitHub Actions (P1)"
```

---

### Task 12: CORS com allowlist (P4)

**Files:**
- Create: `MintlyApi/src/core/config/cors-origins.ts`
- Create: `MintlyApi/src/core/config/cors-origins.spec.ts`
- Modify: `MintlyApi/src/infrastructure/server/build-server.ts:17`
- Modify: `MintlyApi/.env.example`

**Interfaces:**
- Produces: `export function buildCorsOriginChecker (env?: NodeJS.ProcessEnv): (origin?: string) => boolean`

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/core/config/cors-origins.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCorsOriginChecker } from './cors-origins'

describe('buildCorsOriginChecker (P4)', () => {
  it('aceita origem da allowlist', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: 'https://app.mintly.com.br', NODE_ENV: 'production' } as any)
    expect(allowed('https://app.mintly.com.br')).toBe(true)
  })

  it('recusa origem fora da allowlist', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: 'https://app.mintly.com.br', NODE_ENV: 'production' } as any)
    expect(allowed('https://site-malicioso.com')).toBe(false)
  })

  it('aceita requisição SEM Origin (curl, cron, testes com inject)', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: '', NODE_ENV: 'production' } as any)
    expect(allowed(undefined)).toBe(true)
  })

  it('aceita localhost fora de produção (dev contra staging)', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: '', NODE_ENV: 'development' } as any)
    expect(allowed('http://localhost:4200')).toBe(true)
    expect(allowed('http://127.0.0.1:3000')).toBe(true)
  })

  it('recusa localhost EM produção', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: 'https://app.mintly.com.br', NODE_ENV: 'production' } as any)
    expect(allowed('http://localhost:4200')).toBe(false)
  })

  it('aceita múltiplas origens no CSV, ignorando espaços', () => {
    const allowed = buildCorsOriginChecker({
      CORS_ORIGINS: 'https://a.com, https://b.com',
      NODE_ENV: 'production',
    } as any)
    expect(allowed('https://a.com')).toBe(true)
    expect(allowed('https://b.com')).toBe(true)
    expect(allowed('https://c.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/core/config/cors-origins.spec.ts
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/core/config/cors-origins.ts`:

```ts
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Allowlist de origens do CORS (P4). Antes disto o servidor usava
 * `cors({ origin: true })`, que REFLETE qualquer `Origin` — ou seja, qualquer site
 * podia chamar a API pelo navegador. Com auth via Bearer o estrago é limitado (o
 * atacante não tem o token da vítima), mas é porta aberta sem motivo.
 *
 * Regras:
 *  - Origem listada em `CORS_ORIGINS` (CSV) → passa.
 *  - **Sem** header `Origin` (curl, o cron, testes com `fastify.inject`) → passa.
 *    CORS é proteção de navegador, não firewall: bloquear aqui não protegeria nada
 *    e quebraria todo cliente não-browser.
 *  - `localhost`/`127.0.0.1` fora de produção → passa (desenvolver o front contra a
 *    staging não pode exigir mexer em config). Em produção, não.
 */
export function buildCorsOriginChecker (
  env: NodeJS.ProcessEnv = process.env,
): (origin?: string) => boolean {
  const allowlist = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  const isProduction = env.NODE_ENV === 'production'

  return function isOriginAllowed (origin?: string): boolean {
    if (!origin) return true
    if (allowlist.includes(origin)) return true
    if (!isProduction && LOCALHOST.test(origin)) return true
    return false
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/core/config/cors-origins.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Ligar no servidor**

Em `build-server.ts`, adicione ao import:

```ts
import { buildCorsOriginChecker } from '../../core/config/cors-origins'
```

E substitua a linha 17 (`await server.register(cors, { origin: true })`) por:

```ts
  // Allowlist por CORS_ORIGINS (P4) — ver core/config/cors-origins.ts.
  const isOriginAllowed = buildCorsOriginChecker()
  await server.register(cors, {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true)
      callback(new Error('Origem não permitida pelo CORS.'), false)
    },
  })
```

- [ ] **Step 6: Documentar a variável**

Em `.env.example`, adicione:

```bash
# Allowlist do CORS: origens completas separadas por vírgula (P4).
# Fora de produção, localhost/127.0.0.1 é liberado automaticamente.
CORS_ORIGINS=https://mintly.vercel.app,https://app.mintly.com.br
```

- [ ] **Step 7: Rodar a suíte inteira (regressão)**

```bash
npm run test:ci
```

Esperado: PASS. As specs de integração usam `fastify.inject` (sem header `Origin`), então continuam
passando — é exatamente o caso "sem Origin → passa".

- [ ] **Step 8: Commit**

```bash
git add src/core/config src/infrastructure/server/build-server.ts .env.example
git commit -m "fix(seguranca): CORS com allowlist por CORS_ORIGINS (P4)"
```

---

### Task 13: Tipo da conta imutável e taxa coerente (P5)

**Files:**
- Create: `MintlyApi/src/app/financial-account/account-rules.ts`
- Create: `MintlyApi/src/app/financial-account/account-rules.spec.ts`
- Modify: `MintlyApi/src/app/financial-account/financial-account-controller.ts:13-41`
- Test: `MintlyApi/src/app/financial-account/financial-account.int.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AccountUpdateChanges {
    type?: string
    feePercent?: number
    settlementDays?: number
  }
  export function assertAccountUpdateAllowed (storedType: string, changes: AccountUpdateChanges): void
  ```
  Lança `ConflictError`. Regra **pura** — sem Mongo, espelhando `movement-rules.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/app/financial-account/account-rules.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assertAccountUpdateAllowed } from './account-rules'
import { ConflictError } from '../../core/errors/auth/conflict-error'

describe('assertAccountUpdateAllowed (P5)', () => {
  it('rejeita troca de tipo (o tipo da conta é imutável)', () => {
    expect(() => assertAccountUpdateAllowed('bank', { type: 'platform' }))
      .toThrow(ConflictError)
  })

  it('rejeita feePercent em conta que não é platform', () => {
    expect(() => assertAccountUpdateAllowed('bank', { feePercent: 5 }))
      .toThrow(ConflictError)
  })

  it('rejeita settlementDays em conta que não é platform', () => {
    expect(() => assertAccountUpdateAllowed('cash', { settlementDays: 30 }))
      .toThrow(ConflictError)
  })

  it('aceita feePercent em conta platform', () => {
    expect(() => assertAccountUpdateAllowed('platform', { feePercent: 15 })).not.toThrow()
  })

  it('aceita edição sem campos de taxa em qualquer conta', () => {
    expect(() => assertAccountUpdateAllowed('bank', {})).not.toThrow()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/app/financial-account/account-rules.spec.ts
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar a regra pura**

Crie `src/app/financial-account/account-rules.ts`:

```ts
import { FinancialAccountType } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'

export interface AccountUpdateChanges {
  type?: string
  feePercent?: number
  settlementDays?: number
}

/**
 * Regras do PATCH de conta (P5) — puras, testáveis sem Mongo (espelha
 * `financial-movement/movement-rules.ts`).
 *
 * Por que a regra mora AQUI e não no schema: a coerência `platform ⇔ taxa/prazo`
 * depende do tipo ARMAZENADO, e num PATCH parcial o `type` não vem no payload. O
 * Sapphire também não tem `refine`/`superRefine`, então a união discriminada só
 * consegue impor a regra na CRIAÇÃO. O update depende de estado — logo, é regra de
 * aplicação.
 *
 * O `type` é IMUTÁVEL: trocá-lo permitiria criar uma conta `platform` sem taxa/prazo
 * (estado que a criação proíbe) e reescreveria o significado do histórico, já que
 * `defaultStatus`/`computeSnapshot` decidem tudo pelo tipo da conta. O schema da lib
 * já rejeita o campo; este guard existe para dar uma mensagem clara em vez de um
 * VALIDATION_ERROR seco.
 */
export function assertAccountUpdateAllowed (storedType: string, changes: AccountUpdateChanges): void {
  if (changes.type !== undefined) {
    throw new ConflictError(
      'O tipo da conta não pode ser alterado. Inative esta conta e crie outra com o tipo correto.',
    )
  }

  const touchesFee = changes.feePercent !== undefined || changes.settlementDays !== undefined
  if (touchesFee && storedType !== FinancialAccountType.Platform) {
    throw new ConflictError(
      'Somente contas do tipo plataforma têm taxa (feePercent) e prazo de liquidação (settlementDays).',
    )
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/app/financial-account/account-rules.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Ligar no controller**

Em `financial-account-controller.ts`, guarde a referência do repositório e chame a regra no `update`.
Substitua o construtor e o método `update` (linhas 13-41):

```ts
export class FinancialAccountController extends CrudController<FinancialAccount, string> {
  constructor (
    // Guardado (diferente de antes): o update precisa ler o TIPO ARMAZENADO da conta
    // para validar a coerência platform ⇔ taxa/prazo (P5) — o PATCH parcial não traz
    // o `type`, e o schema não conhece o estado do banco.
    private readonly accountRepo: FinancialAccountRepository,
    private readonly setDefaultUseCase: SetDefaultAccountUseCase,
    private readonly inactivateUseCase: InactivateAccountUseCase,
  ) {
    super(
      accountRepo,
      financialAccountInsertSchema as any,
      financialAccountUpdateSchema as any,
      Resource.FinancialAccount,
    )
  }

  /**
   * PATCH /:id — guards de update:
   *  - `isDefault` não é editável aqui (rota própria: PATCH /:id/default).
   *  - `type` é imutável e taxa/prazo só existem em conta `platform` (P5) — regra
   *    pura em `account-rules.ts`, aplicada contra o tipo ARMAZENADO.
   */
  async update (id: string, item: Partial<FinancialAccount>, source?: ContextSource): Promise<ResponseStructure> {
    if (item.isDefault !== undefined) {
      throw new ConflictError('O campo isDefault não pode ser editado manualmente. Use a rota específica de SetDefault.')
    }

    const changes = item as AccountUpdateChanges
    const touchesTypeOrFee =
      changes.type !== undefined ||
      changes.feePercent !== undefined ||
      changes.settlementDays !== undefined

    // Só vai ao banco quando o PATCH mexe em tipo/taxa — não onera um rename.
    if (touchesTypeOrFee) {
      const ctx = buildRequestContext(source)
      const stored = await this.accountRepo.findById(id, ctx)
      if (!stored) {
        throw new NotFoundError(Resource.FinancialAccount, id)
      }
      assertAccountUpdateAllowed(String((stored as any).type), changes)
    }

    return super.update(id, item, source)
  }
```

Ajuste os imports do arquivo, adicionando:

```ts
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { assertAccountUpdateAllowed, AccountUpdateChanges } from './account-rules'
```

- [ ] **Step 6: Adicionar os casos de integração**

Em `financial-account.int.spec.ts`:

```ts
it('PATCH com type é rejeitado — tipo da conta é imutável (P5)', async () => {
  const response = await server.inject({
    method: 'PATCH',
    url: `/financial-accounts/${bankAccountId}`,
    headers: authHeaders,
    payload: { type: 'platform' },
  })

  expect(response.statusCode).toBeGreaterThanOrEqual(400)
  expect(response.statusCode).toBeLessThan(500)
})

it('PATCH com feePercent em conta bank é rejeitado (P5)', async () => {
  const response = await server.inject({
    method: 'PATCH',
    url: `/financial-accounts/${bankAccountId}`,
    headers: authHeaders,
    payload: { feePercent: 5 },
  })

  expect(response.statusCode).toBeGreaterThanOrEqual(400)
  expect(response.statusCode).toBeLessThan(500)
})

it('PATCH com feePercent em conta platform é aceito (P5)', async () => {
  const response = await server.inject({
    method: 'PATCH',
    url: `/financial-accounts/${platformAccountId}`,
    headers: authHeaders,
    payload: { feePercent: 15 },
  })

  expect(response.statusCode).toBe(200)
})
```

- [ ] **Step 7: Rodar o módulo inteiro**

```bash
npx vitest run src/app/financial-account
```

Esperado: PASS. Se alguma spec existente enviava `type` num PATCH, ela agora falha **corretamente** —
ajuste a spec (o comportamento novo é o desejado), não a regra.

- [ ] **Step 8: Commit**

```bash
git add src/app/financial-account
git commit -m "fix(conta): tipo imutavel e taxa so em conta platform no PATCH (P5)"
```

---

### Task 14: Verificação final, doc e PR

**Files:**
- Modify: `MintlyApi/src/app/financial-account/financial-account-routes.ts:26` (comentário
  desatualizado)
- Modify: `Mintly/PROBLEMAS-FUTUROS.md`

- [ ] **Step 1: Corrigir o comentário mentiroso da rota**

Em `financial-account-routes.ts`, linha 26, o comentário ainda anuncia `type` como editável:

```ts
  // PATCH /financial-accounts/:id  (edição parcial: name, status, feePercent, settlementDays)
  // `type` NÃO é editável — o tipo da conta é imutável (P5).
```

- [ ] **Step 2: Rodar a barra completa**

```bash
npm run lint && npm run typecheck && npm run test:ci && npm run build && npm run validate:swagger
```

Esperado: tudo PASS, cobertura ≥ 90% em lines/statements/branches/functions.

- [ ] **Step 3: Atualizar o PROBLEMAS-FUTUROS.md**

Em `C:\Users\alexa\code\Mintly\PROBLEMAS-FUTUROS.md`, marque P1, P3, P4, P5 e P7 como resolvidos
(seguindo o formato do P2 já resolvido: título riscado com `~~`, `✅ RESOLVIDO`, e uma linha dizendo
onde foi resolvido). O **P6 continua aberto** — é o único item restante, e tem spec própria pela
frente.

- [ ] **Step 4: Commit e PR**

```bash
git add -A
git commit -m "docs: PROBLEMAS-FUTUROS - P1/P3/P4/P5/P7 resolvidos"
git push -u origin fix/20260713/problemas-futuros
gh pr create --base staging \
  --title "fix(20260713): problemas futuros P1/P3/P4/P5/P7" \
  --body "Settler de liquidacao por data (P1), snapshot congelado na edicao (P3), CORS com allowlist (P4), tipo de conta imutavel (P5), Headers fechado (P7). Depende de mintly-lib <VERSAO>. P6 (casts \`as\`) segue aberto, com spec propria."
```

- [ ] **Step 5: Rodar o settler em staging (a primeira vez, na mão)**

Depois do merge e do deploy, dispare o workflow `Settle Due Movements` manualmente
(`workflow_dispatch`) e confira o log: ele deve liquidar o backlog de jan–jun (~R$34k) numa tacada.
Confira um extrato de conta plataforma antes e depois — o `availableBalance` deve subir e o
`predictedBalance` cair no mesmo montante.
