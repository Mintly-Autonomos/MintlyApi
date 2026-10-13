# Andamento — módulos novos

Documento **vivo**: onde estamos, o que vem depois e o que precisa ser rodado no ambiente.
Atualizado a cada fatia. O roteiro completo (o quê e por quê) está em
`specs/modulos-novos/20260929/design.md`, Parte 5; as decisões de negócio em aberto, em
`specs/modulos-novos/pendencias-negocio.md`.

Última atualização: **12/10/2026**.

---

## Passo atual

**Fatia 4 — Resultado (DRE)** — `GET /reports/result`. Consome o `dreGroup` e o perfil tributário da fatia 3.

- Etapa: ~~perguntas~~ ✅ → ~~spec~~ ✅ → ~~plano~~ ✅ → ~~TDD~~ ✅ → ~~revisão final~~ ✅ → ~~teste local~~ ✅ →
  ~~PR da lib~~ ✅ (MintlyLib#29, `2.12.0-preview`) → **PR da API aberto, aguardando review**.
- Spec: `specs/modulos-novos/20261012/resultado-dre.md`; plano: `specs/modulos-novos/20261012/plan-resultado-dre.md`.
- Branch: `feat/20261012/resultado-dre` (lib e API).
- Validação: suíte 798/798 (cobertura 98,5 / 97,8 / 99,0 / 98,9); `result-metrics.ts` com 100%; E2E contra o
  Atlas 6/6; seed `SEED_SCENARIO=result` e backend local dirigidos por HTTP.
- A revisão final corrigiu a spec: o ponto de equilíbrio é **receita bruta** (antes saía em receita líquida).

## Fatias

| # | Fatia | Lib | API | Estado |
|---|---|---|---|---|
| 1 | `dueDate` (M1) — MIN-89 | #26 ✅ mergeado (`2.9.0-preview`) | #39 ✅ mergeado | Concluída — falta o backfill em staging |
| 2 | **Fluxo de Caixa** — MIN-90 / MIN-94 | #27 ✅ mergeado (`2.10.0-preview`) | #40 ✅ mergeado | Concluída |
| 3 | `dreGroup` + `mixed` + alíquota (M2, M5) — MIN-23 | #28 ✅ mergeado (`2.11.0-preview`) | #41 ✅ mergeado | Concluída — faltam os comandos de staging |
| 4 | Resultado (DRE) | #29 ✅ mergeado (`2.12.0-preview`) | PR aberto | **Em review** |
| 5 | Subcategoria + `channel` (M3, M4) | — | — | Na fila |
| 6 | Custos & Despesas — fatia A | — | — | Na fila |
| 7 | Custos & Despesas — fatia B | — | — | Na fila |
| 8 | Visão Geral | — | — | Na fila |
| 9 | Receitas, Previsões | — | — | Bloqueado (domínio de vendas) |

## Próximos passos

1. Rodar o backfill de staging abaixo (o #39 já foi mergeado).
2. Rodar os comandos da fatia 3 abaixo (o #41 já foi mergeado).
3. Review e merge do PR da API da fatia 4.
4. Fatia 5: subcategoria + `channel` (M3, M4).

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
