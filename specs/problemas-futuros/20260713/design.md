# Problemas futuros — design da resolução (P1, P3, P4, P5, P7)

**Data:** 2026-07-13
**Origem:** `Mintly/PROBLEMAS-FUTUROS.md` (itens abertos desde o code review de 07/07)
**Escopo:** P1, P3, P4, P5, P7. O **P6** (eliminar os casts `as`) fica **fora** desta spec —
é refactor de tipos com risco de esconder mudança de comportamento e merece spec e PRs próprios,
por módulo.

---

## Contexto

Os cinco itens são independentes entre si, mas P1 e P3 tocam o mesmo domínio (movimentação
financeira e seu snapshot de taxa/prazo) e uma decisão apoia a outra: só faz sentido liquidar
por data se a data prevista for confiável, e ela só é confiável se a edição não a reescrever.

**Três itens exigem mudança na MintlyLib** (`statusSource`, remoção do `type` do update de conta,
tipo `Headers`), duas delas *breaking*. Isso implica release da lib e bump da dependência na API.
Breaking changes foram explicitamente aprovadas.

---

## P1 — Liquidação automática de movimentos de plataforma

### Problema

Entradas em conta `platform` (iFood/Rappi) nascem `pending` e alimentam o `predictedBalance`
("a receber"). O `predictedReceiptDate` é calculado e gravado (`movement-rules.ts:83`), mas
**nenhum código o lê** e não existe job que reavalie o status por data. A única saída de `pending`
é o `PATCH /financial-movements/:id/status` manual. O `recompute-balances.use-case.ts:43` também
decide o bucket pelo **status persistido**, então nem a reconciliação liquida por data.

Efeito: o `availableBalance` subestima o caixa real. No seed de staging (jul/2026), ~R$34k de
jan–jun estão presos em "a receber".

### Decisão

**Liquidação automática por data, com reversão manual e trava permanente.**

Passou a data prevista, o movimento vira `settled` e o dinheiro migra de `predictedBalance` para
`availableBalance` sem ação do usuário — é o que acontece na vida real com as plataformas. Se o
repasse não caiu de fato, o dono reverte para `pending`, e o settler **nunca mais** toca naquele
movimento.

### Modelo de dados

Novo campo no movimento (MintlyLib, `financial-movement-schema.ts`):

```ts
statusSource: 'auto' | 'manual'   // opcional no schema
```

Regras:

- O `register-movement` **grava `statusSource: 'auto'`** explicitamente (o campo não é aceito no
  payload do client; é o servidor que o define, como já faz com o `status`).
- Qualquer `PATCH /:id/status` — ação humana — carimba `statusSource: 'manual'`.
- O settler só considera movimentos com `statusSource !== 'manual'`.
- **Campo ausente é lido como `auto`.** É isso que faz o backlog atual liquidar na primeira rodada,
  sem script de migração.

O `PATCH /:id` (update geral) **não** carimba `manual` por si só; só carimba se o payload alterar
o `status`. Editar o título de um movimento não deve tirá-lo do controle do settler.

### Use-case

`SettleDueMovementsUseCase` — **puro**: sem Fastify, sem HTTP, sem header. Recebe `{ env, now }` e
devolve `{ settled: number, failed: number }` para o script logar.

Uma query por ambiente, **sem filtro de `restaurantId`**:

```
status: 'pending'
statusSource: { $ne: 'manual' }
predictedReceiptDate: { $lte: now }
```

O tenant é campo do documento, não banco — então os restaurantes saem de graça no resultado. Não
existe "enumerar tenants".

Cada movimento liquida em **transação própria** (não uma transação única gigante: um documento
problemático não pode derrubar a rodada inteira). A mecânica de saldo é exatamente a que o
`ChangeMovementStatusUseCase` já usa — reverte o impacto do status antigo, aplica o do novo, via
`balanceImpact` + `applyBalanceImpact`.

**Idempotência:** o filtro do `updateOne` inclui `status: 'pending'`. Duas rodadas concorrentes não
liquidam o mesmo movimento duas vezes; a segunda não casa o filtro e não faz nada.

**Refactor de suporte:** extrair de `ChangeMovementStatusUseCase` a função que aplica troca de
status + correção de saldo (algo como `applyStatusTransition(movements, accounts, mov, newStatus,
actor, session, now)`), e fazer os dois use-cases chamarem a mesma coisa. Sem isso, a regra de saldo
existiria duplicada em dois lugares.

**Auditoria:** cada liquidação empilha em `history[]` com `by: 'system'` e
`action: 'status:pending->settled'`, e atualiza `audit.updatedAt`.

**Contas inativas:** o settler liquida normalmente movimentos de conta inativa — o dinheiro caiu de
fato; inativar a conta não desfaz o recebimento.

**Corte de data:** `predictedReceiptDate <= now` (UTC). Sem tratamento de fuso: o campo é gravado
como data-hora e a janela do job (1x/dia) torna a diferença de fuso irrelevante na prática — no pior
caso um movimento liquida algumas horas mais tarde.

### Gatilho

`npm run db:settle` (`scripts/movements/settle-due.ts`), agendado num workflow do GitHub Actions
(1x/dia). O script:

1. conecta no Mongo (mesmos secrets já usados pelo `db:indices`);
2. lê os ambientes de `app.valid_environments`;
3. chama `SettleDueMovementsUseCase` para cada um;
4. loga o resumo e sai.

**Por que não um endpoint:** um settler exposto por HTTP exigiria um segundo mecanismo de auth
(segredo compartilhado) ou um usuário de sistema — e este último obrigaria a tornar `restaurantId`
opcional no `userSchema` e criar uma role `system`, afrouxando a invariante mais importante da API
("todo token tem dono") para atender um robô. O script direto no banco não cria superfície nova e
tem precedente no repo (`db:indices` roda assim no workflow de deploy).

**Portabilidade:** como o use-case é puro, transformá-lo em Lambda (ou expor por rota) depois é
trocar o adaptador — o núcleo não muda.

### Reversão pelo dono

Já existe e não muda de forma: `PATCH /financial-movements/:id/status` de `settled` para `pending`
reverte o saldo na mesma transação. A única diferença é que agora essa ação carimba
`statusSource: 'manual'` e tira o movimento do alcance do settler para sempre.

---

## P3 — PATCH parcial re-precifica o movimento

### Problema

`update-movement.use-case.ts:85` chama `computeSnapshot` passando a **conta viva**, então recomputa
`feeValue`/`netValue`/`predictedReceiptDate` com a taxa e o prazo **atuais** da conta. Se a taxa do
iFood mudou de 12% para 15% em maio, corrigir o título de um movimento de janeiro reescreve o
líquido dele com 15% e mexe no saldo. Os campos `feePercentApplied`/`settlementDaysApplied` existem
justamente para ser o retrato do lançamento, mas nunca são lidos de volta.

### Decisão

**Congelar o snapshot.** A edição reaproveita `feePercentApplied` / `settlementDaysApplied` gravados
no movimento.

- Editar `title`/`description`/`fiscalNote`/etc. → não mexe em dinheiro nenhum.
- Editar `grossValue` → aplica a **taxa histórica** sobre o novo bruto.
- Editar `date` → recalcula `predictedReceiptDate` com o **prazo histórico**.
- **Trocar a conta do movimento** → não existe snapshot aplicável à conta nova; vale a taxa/prazo
  **atuais da conta nova**. É a única exceção, e é natural.

O `register-movement` não muda: no lançamento, a conta viva *é* a fonte legítima do snapshot.

### Implementação

`computeSnapshot` passa a receber a taxa e o prazo a aplicar em vez de derivá-los da conta:

```ts
computeSnapshot({ direction, grossValue, date, account, fee?: { percent, settlementDays } })
```

Quando `fee` vem, usa-o; quando não vem (registro, ou troca de conta), deriva da conta como hoje.
A decisão de qual passar é do `update-movement.use-case`: se `changes.accountId` mudou a conta, não
passa `fee`; senão, passa o congelado.

---

## P4 — CORS `origin: true`

### Problema

`build-server.ts:17` usa `cors({ origin: true })`, que reflete qualquer `Origin` — na prática,
qualquer site pode chamar a API pelo navegador. Com auth via Bearer o estrago é limitado (o
atacante não tem o token da vítima), mas é uma porta aberta sem motivo.

### Decisão

Allowlist por variável de ambiente.

- Nova env var `CORS_ORIGINS` (CSV de origens completas, ex.:
  `https://mintly.vercel.app,https://app.mintly.com.br`).
- Fora de produção (`NODE_ENV !== 'production'`), `localhost` (qualquer porta) é liberado
  automaticamente — desenvolver o front contra staging não pode exigir mexer em config.
- Em produção, só o que está na lista.
- Requisições **sem** header `Origin` (curl, o cron, testes com `fastify.inject`) continuam
  passando: CORS é proteção de navegador, não firewall.
- Origens a cadastrar: front de staging (Vercel), front de produção e localhost (dev).

---

## P5 — Update de conta aceita taxa em conta não-platform

### Problema

O `financialAccountUpdateSchema` é um objeto achatado `.partial()`, então num PATCH sem `type` não
dá para saber o tipo da conta e `{ feePercent: 5 }` numa conta `bank` passa. O Sapphire não tem
`refine`/`superRefine`, então a regra cruzada não é expressável no schema.

**Agravante descoberto na exploração:** o schema de update **inclui `type`** entre os campos
editáveis. Hoje é possível `PATCH { type: 'platform' }` numa conta bancária, criando uma conta
plataforma **sem taxa nem prazo** — estado que a criação (união discriminada) jamais permitiria. E
o inverso deixa `feePercent` órfão no documento. Pior: trocar o tipo de uma conta com movimentos
reescreve o significado do histórico dela, já que `defaultStatus` e `computeSnapshot` decidem tudo
pelo `type`.

### Decisão

**O `type` da conta é imutável.**

- **MintlyLib:** remover `type` do `financialAccountUpdateSchema` (breaking). O objeto é estrito,
  então mandar `type` num PATCH passa a ser rejeitado pela validação.
- **MintlyApi:** a regra é **pura** (não precisa de transação nem de escrita), então vira
  `financial-account/account-rules.ts` — espelhando o `financial-movement/movement-rules.ts`, que é
  o padrão do repo para regra de domínio testável sem Mongo. O `FinancialAccountController.update`
  carrega a conta armazenada pelo repositório (só quando o PATCH mexe em tipo/taxa — um rename não
  paga essa consulta), aplica a regra e segue para o `CrudUseCase`, que já cuida do `audit`. Mantém
  o guard de `isDefault` que já existe.

  > Uma versão anterior deste design falava num `UpdateAccountUseCase`. Descartado: um use-case
  > transacional para uma validação sem escrita seria cerimônia sem ganho, e reimplementaria o
  > `audit` que o `CrudUseCase` já resolve.

Se o dono errou o tipo no cadastro, ele inativa a conta e cria outra. É fricção aceitável perto do
custo de um histórico financeiro sem sentido.

Alterar a taxa de uma conta `platform` continua permitido — e, graças ao P3, **não** reescreve o
passado: os movimentos antigos guardam o snapshot deles.

---

## P7 — `restaurantId` como header (campo morto)

### Estado real (verificado)

- A API **não lê** `restaurantId` de header em lugar nenhum — vem exclusivamente do JWT
  (`build-request-context.ts:43-44`).
- O MintlyWeb **não menciona** `restaurantId` nem uma vez.
- O único resíduo é o *index signature* aberto no tipo `Headers` da lib
  (`[key: string]: string | undefined`), que ainda deixa o campo passar em silêncio.

### Decisão

**Fechar o tipo** (MintlyLib, `src/core/data/request/headers.ts`):

```ts
export type Headers = {
  env: string
  authorization?: string
}
```

Sem index signature. Contrato fechado: quem é dono do dado vem do token. É breaking — se algum
client da lib depender de passar headers extras (verificar `core/client/request-config.ts`), o
ajuste entra no mesmo PR.

---

## Testes

Seguindo a pirâmide existente (`specs/testes/20260531/cobertura-90.md`), threshold de 90%.

**Unitário (regras puras, sem Mongo):**
- `computeSnapshot` com taxa congelada: taxa histórica aplicada sobre novo bruto; data prevista com
  prazo histórico; troca de conta usa a conta nova.
- Allowlist de CORS: origem na lista passa; fora da lista não; localhost passa fora de produção e
  não passa em produção; sem `Origin` passa.
- `UpdateAccountUseCase`: rejeita `feePercent` em conta não-platform; aceita em `platform`.

**Integração (`mongodb-memory-server`, stack real):**
- Settler: liquida o que venceu; **ignora** o `statusSource: 'manual'`; trata campo ausente como
  `auto`; é **idempotente** (rodar duas vezes não duplica saldo); move o valor de `predictedBalance`
  para `availableBalance` corretamente.
- `PATCH /:id/status` carimba `manual`; o settler passa a ignorar aquele movimento.
- `PATCH /:id` de campo inócuo (`title`) **não altera** `netValue` nem o saldo, mesmo após a taxa da
  conta ter mudado.
- `PATCH` de conta com `type` é rejeitado; `PATCH` com `feePercent` em conta `bank` é rejeitado.

---

## Ordem de entrega

1. **MintlyLib** — os três schemas num release só: `statusSource` no movimento, `type` fora do
   update de conta, `Headers` fechado. Bump minor+breaking, publica `preview`.
2. **MintlyApi** — consome a nova versão da lib e implementa: settler (use-case + script + workflow),
   snapshot congelado, `UpdateAccountUseCase`.
3. **P4 (CORS)** — independente de tudo; pode ir em qualquer PR ou sozinho.

Após a entrega, atualizar `Mintly/PROBLEMAS-FUTUROS.md` marcando P1/P3/P4/P5/P7 como resolvidos e
deixando o P6 como único item aberto.
