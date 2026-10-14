# Andamento — módulos novos

Documento **vivo**: onde estamos, o que vem depois e o que precisa ser rodado no ambiente.
Atualizado a cada fatia. O roteiro completo (o quê e por quê) está em
`specs/modulos-novos/20260929/design.md`, Parte 5; as decisões de negócio em aberto, em
`specs/modulos-novos/pendencias-negocio.md`.

Última atualização: **13/10/2026**.

---

## Passo atual

**Ajustes pós-teste das telas (itens 1 a 5)** — spec `specs/modulos-novos/20261014/ajustes-telas.md`.

- Origem: revisão das prints × API + teste local com dados (13/10/2026). Decidido pelo dono: aplicar as recomendações.
- A1 mês atual comparado pelo mesmo período · A2 projeção de despesa por comportamento · A3 insights de CMV/prime na base do score · A4 score exige 2 pilares · A5 repasses de plataforma agrupados. Extras achados no teste: DRE não lista despesa zerada nos dois lados; repasse usa o nome atual da conta.
- Teste pesado (local, Mongo em memória): 5 restaurantes, ~4.700 lançamentos, todos os meses/canais/horizontes e entradas inválidas, com oráculo independente — 57.645 checks, 3 falhas conhecidas do próprio roteiro (conta com saldo não inativa: 409 esperado). Telas respondem em < 110 ms com ~3.900 lançamentos.
- Branch: `feat/20261014/ajustes-telas` (lib e API). Etapa: TDD ✅ → conferência (revisor) → PR da lib → `npm i` → PR da API.

## Fatias

| # | Fatia | Lib | API | Estado |
|---|---|---|---|---|
| 1 | `dueDate` (M1) — MIN-89 | #26 ✅ mergeado (`2.9.0-preview`) | #39 ✅ mergeado | Concluída — falta o backfill em staging |
| 2 | **Fluxo de Caixa** — MIN-90 / MIN-94 | #27 ✅ mergeado (`2.10.0-preview`) | #40 ✅ mergeado | Concluída |
| 3 | `dreGroup` + `mixed` + alíquota (M2, M5) — MIN-23 | #28 ✅ mergeado (`2.11.0-preview`) | #41 ✅ mergeado | Concluída — faltam os comandos de staging |
| 4 | Resultado (DRE) | #29 ✅ mergeado (`2.12.0-preview`) | #42 ✅ mergeado | Concluída |
| 5 | Subcategoria + `channel` (M3, M4) | #30 ✅ mergeado (`2.13.0-preview`) | #43 ✅ mergeado | Concluída |
| 6 | Custos & Despesas — fatia A | #31 ✅ mergeado (`2.14.0-preview`) | #44 ✅ mergeado | Concluída |
| 7 | Custos & Despesas — fatia B | #32 ✅ mergeado (`2.15.0-preview`) | #45 ✅ mergeado | Concluída |
| 8 | Visão Geral | #33 ✅ mergeado (`2.16.0-preview`) | #46 ✅ mergeado | Concluída |
| 9 | Receitas, Previsões | — | — | Bloqueado (domínio de vendas) |

## Próximos passos

1. Rodar o backfill de staging abaixo (o #39 já foi mergeado).
2. Rodar os comandos da fatia 3 abaixo (o #41 já foi mergeado).
3. Ajustes pós-teste: revisão → PR da lib → PR da API. Pendências para o front e o negócio (itens 6–9 da revisão das telas) abaixo.

## Postar no Jira (quando o MCP do Atlassian voltar)

O MCP do Atlassian só volta reiniciando a sessão. Até lá, o que precisa ir para o Jira fica aqui:

- [ ] **MIN-94** (Fluxo de Caixa): comentário com a spec `specs/modulos-novos/20261012/fluxo-de-caixa.md`.
- [ ] **MIN-94**: subtarefas no padrão do projeto (uma por branch) — lib `feat/20261012/fluxo-de-caixa`
      (MintlyLib#27) e API `feat/20261012/fluxo-de-caixa` (MintlyApi#40), ambas concluídas.
- [ ] **MIN-94**: comentário de execução — o que foi entregue, validação (691 testes, E2E 4/4,
      backend local), achados da revisão corrigidos, pendências menores (lista abaixo).
- [ ] **MIN-89** (fatia 1): comentário de que o #39 foi mergeado e o backfill de staging está pendente.
- [ ] **MIN-90 / MIN-94**: mover para concluído, se o fluxo do board permitir.
- [ ] **MIN-23**: comentário dizendo que a fatia 3 implementa o cálculo (sem `daily_sales`: RBT12 de
      `financial_movements`), com a spec `specs/modulos-novos/20261012/classificacao-contabil.md`.
- [ ] **Fatia 3**: história/subtarefas para lib e API (ainda não existem no Jira).
- [ ] **Fatia 4 (Resultado/DRE)**: épico/história e subtarefas (ainda não existem no Jira) + spec `20261012/resultado-dre.md`.
- [ ] **Fatia 8 (Visão Geral)**: história/subtarefas (lib #33, API #46) + spec `20261013/visao-geral.md`; N5 (pesos/faixas do score) segue aberto.
- [ ] **Fatia 7 (Custos & Despesas, fatia B)**: história/subtarefas (lib #32, API #45) + spec `20261013/custos-despesas-b.md`; N4 (limiares) segue aberto.
- [ ] **Fatia 6 (Custos & Despesas, fatia A)**: história/subtarefas (lib #31, API #44) + spec `20261013/custos-despesas.md`.
- [ ] **Fatia 5 (Subcategoria + canal)**: história/subtarefas (lib #30, API #43) + spec `20261013/subcategoria-canal.md`; mínimos adiados da revisão (NFC no nome, max(60) antes do trim, `null` no `updateMovementSchema` da lib).

## Em aberto (não bloqueia a fatia atual)

- **Bump de versão da lib:** o `ci.yml` da MintlyLib trata `feat!:` como *minor* e ignora o
  rodapé `BREAKING CHANGE:` — só `release:` gera major. A remoção de `predictedReceiptDate`
  saiu como `2.8.0-preview → 2.9.0-preview`. Decidir se corrige o `ci.yml` ou só registra.
- **E2E da capacidade nova da fatia 1:** saída com vencimento e o ida-e-volta do P8 só têm
  cobertura de integração.
- **MintlyWeb × contrato com número cru (N9):** precisa estar combinado antes do Fluxo de Caixa
  substituir o mock.
- **Datas sem horário no registro/edição de movimentação:** `date`/`dueDate` em `AAAA-MM-DD` são
  lidas como meia-noite UTC — 21h do dia anterior em São Paulo. A fatia 2 corrigiu isso só para o
  `settledAt` do PATCH de status; no POST/PATCH de movimentação é comportamento das fatias
  anteriores. Conferir como o MintlyWeb envia essas datas antes de mexer.

### Pendências da revisão das telas (13/10/2026) — para o front e o negócio

- **"Despesa" tem três sentidos:** Custos e o gráfico Receita × Despesa = todas as saídas (CMV, DAS, taxas); cascata/Resultado = despesas operacionais. O front precisa rotular diferente ("Saídas" × "Despesas operacionais").
- **Ponto projetado:** a API projeta o fechamento do mês atual no mesmo mês; o protótipo desenha "mês seguinte (proj.)". Definir a regra de desenho.
- **Filtro "Salão" vazio na prática:** saída sem canal conta como da casa (N3 — rateio). Usar `sharedExcluded` para explicar.
- **Natureza não operacional ignorada:** aporte/empréstimo lançado como entrada infla receita, CMV %, DRE e score. Decidir regra.
- Menores (front): alerta de caixa apertado traz o 1º dia abaixo da margem (o "R$ 900 no dia 22" vem de `lowestBalance`); semanas em 5 blocos para 30 dias; "cada real vendido tem X% de margem" = `fixedCosts / breakEvenRevenue`; sem dia estimado do equilíbrio no mês atual; sem série no card "Projeção 30 dias"; taxa de plataforma 1 linha no DRE × por conta em Custos; onde o "misto" entra nos filtros.

### Pendências da fatia 8

- **Score de saúde (N5):** pesos, pontas dos pilares e faixas seguem o palpite — validar com o negócio.
- Decidido na revisão: no mês atual o score usa o último mês fechado + fôlego de hoje; mês passado sem fôlego (`health.basisMonth`); receita projetada não multiplica venda lançada para depois de hoje.
- Front: Receita × Despesa repete o mês atual (ponto real + ponto `projected`) — chave por `month` colide.
- Menores: relógio lido por cada consulta (virada de mês à meia-noite); `month` inválido valida dentro das consultas; `deltaPoints` sem arredondar; custo de ~13 leituras por request.

### Pendências da fatia 7

- **Limiares de anomalia (N4):** seguem o palpite (≥ 50% e ≥ R$ 100, base de ≥ 2 meses) — validar com o negócio.
- Decidido na revisão: projeção não multiplica o que está lançado para depois de hoje; base da anomalia conta desde o primeiro gasto da unidade (adoção gradual de subcategoria).
- Gráfico "Por categoria" em M−4/M−5 pode não explicar todo o total (categoria que só teve gasto lá não entra na lista).
- Menores: nome de subcategoria de categoria apagada pode vir vazio; Σ `projected` dos itens pode diferir do total por centavos; campos novos obrigatórios nos tipos da lib (mocks do front).

### Pendências da fatia 6

- ~~% da taxa sobre o delivery~~ — **decidido (A, 13/10/2026):** `pctOfDelivery` usa o bruto das contas de plataforma; `deliveryRevenue` segue pelo canal efetivo. A doc do campo na lib ainda descreve só o `deliveryRevenue` — ajustar o comentário de `pctOfDelivery` na próxima mudança da lib.
- **Nome de categoria/conta apagada:** vem de um lançamento qualquer da janela de 6 meses; preferir o do mês mais recente (cosmético).
- Arredondamento: `total.average3` pode diferir de Σ `items[].average3` por centavos; item cuja única atividade na média é 1 centavo some da lista.

### Pendências da fatia 4

- **Histórico de regime tributário:** o regime atual vale para os 6 meses do histórico do DRE.
- Menores da revisão: o campo `tax` do mês pode contradizer a linha de imposto (MEI mostra o DAS
  vigente num mês anterior à primeira movimentação, em que o imposto é 0); a consulta de categorias
  não projeta `type`; saída sem categoria vira item de nome vazio; 6 consultas ao `tax_settings` no
  MEI; com custo fixo zero, `reachedOnDay` é 1 mesmo se a primeira venda for depois.

### Pendências da fatia 3

- **Permissão owner × member:** `PATCH /restaurants/me` (regime tributário) está aberto a qualquer
  usuário do restaurante — nenhuma rota diferencia papel hoje.
- **RBT12 a partir da primeira movimentação no Mintly**, não da abertura do CNPJ: restaurante antigo
  que acaba de entrar tem RBT12 proporcional/extrapolado nos primeiros 12 meses de uso.
- **Desconfigurar o regime** (`taxRegime: null`) é recusado — se o front precisar, é decisão nova.
- Menores da revisão: `app.tax_settings` sem índice único em `validFrom`; `month` com ano 0000–0099
  aceito; comentário do `tax-scenario` ("nunca no futuro") impreciso no dia 1 antes das 12h; regex
  `AAAA-MM` duplicada em `reference-month.ts` e `seed-tax-settings.ts`.

### Pendências técnicas da revisão da fatia 2 (menores, não corrigidas)

- `outflowHistory` não pré-filtra por data antes do `$addFields`: varre todas as saídas liquidadas
  do restaurante a cada relatório. O comentário do índice de `settledAt` promete servir esse
  histórico, o que hoje não acontece. Irrelevante no volume atual; cresce com a idade do restaurante.
- A série realizada parte do caixa das contas ativas, mas desfaz liquidações de contas inativas
  também (borda rara: conta inativa não recebe lançamento novo).
- Faltam testes de integração com horário 22h–23h59 nas bordas de dia do repositório (o cenário
  planta tudo ao meio-dia).
- A lista de vencimentos mostra liquidadas de hoje−7 até hoje (8 dias); a série realizada tem 7.
  Documentar qual leitura vale.
- Categoria ausente num movimento vira o texto `"undefined"` no item da lista.
- `DueItem.settledAt` de documento antigo é inferido (`dueDate`/`date`), e o tipo da lib não diz isso.

---

## Comandos pendentes no ambiente

Rodar **de uma vez**, na ordem, depois do merge indicado. A fatia 2 não acrescenta comando: o
`settledAt` não tem migração, e o índice novo sobe com o `db:indices` do deploy. Os índices (`db:indices`) **não** entram aqui: o `deploy.yml` já os roda a cada deploy.

Os scripts conectam pelas mesmas variáveis do app (as do `.env` / da Vercel) e escolhem o banco
por `MONGO_ENV`. O `deploy.yml` usa `vars.MONGO_ENV` quando existe e o nome do environment
quando não — conferir o valor nas Variables do GitHub antes de rodar.

### Staging — já liberado (MintlyApi#39 mergeado em 12/10/2026)

```bash
# Fatia 1 (M1): copia predictedReceiptDate → dueDate e remove o índice antigo.
# Idempotente: a segunda execução reporta 0 | 0 | ausente.
MONGO_ENV=staging npm run db:backfill-due-date
```

### Produção — depois da release que levar a fatia 1 para `main`

```bash
MONGO_ENV=production npm run db:backfill-due-date
```

### Fatia 3 — já liberado (MintlyApi#41 mergeado em 12/10/2026)

```bash
# M2: dá dreGroup às despesas antigas (sistema pelo nome; demais opex). Idempotente.
MONGO_ENV=staging npm run db:backfill-dre-group

# MIN-23: DAS mensal do MEI vigente a partir de janeiro/2026. Banco `app` do cluster:
# UMA execução vale para staging e produção. Comércio: 5% do salário mínimo + R$ 1 de ICMS.
MEI_MONTHLY_DAS=<DAS 2026> VALID_FROM=2026-01 npm run db:seed-tax-settings
```

Na release para produção: `MONGO_ENV=production npm run db:backfill-dre-group`.

Junto da release: promover a lib (`npm dist-tag add mintly-lib@<versão> latest`) — ver
`Mintly/RELEASE-PROCESS.md`.

### Já rodados

Nenhum ainda. Ao rodar, mover o comando para cá com a data e a saída resumida.
