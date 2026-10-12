# Andamento — módulos novos

Documento **vivo**: onde estamos, o que vem depois e o que precisa ser rodado no ambiente.
Atualizado a cada fatia. O roteiro completo (o quê e por quê) está em
`specs/modulos-novos/20260929/design.md`, Parte 5; as decisões de negócio em aberto, em
`specs/modulos-novos/pendencias-negocio.md`.

Última atualização: **12/10/2026**.

---

## Passo atual

**Fatia 2 — Fluxo de Caixa** (épico MIN-90, história MIN-94).

- Etapa: perguntas do módulo → plano → TDD → conferência contra o seed → PR.
- Branch da API: `feat/20261012/fluxo-de-caixa`, empilhada sobre
  `feat/20260929/status-por-vencimento` (MintlyApi#39), porque depende do `dueDate`.
  Quando o #39 for mergeado, rebase em `staging`.
- Lib: branch nova a partir de `staging` (o #26 já está lá).

## Fatias

| # | Fatia | Lib | API | Estado |
|---|---|---|---|---|
| 1 | `dueDate` (M1) — MIN-89 | #26 ✅ mergeado (`2.9.0-preview`) | #39 aberto, CI verde | Aguardando review/merge do #39 |
| 2 | **Fluxo de Caixa** — MIN-90 / MIN-94 | — | — | **Em andamento** |
| 3 | `dreGroup` + `mixed` + alíquota (M2, M5) | — | — | Na fila |
| 4 | Resultado (DRE) | — | — | Na fila |
| 5 | Subcategoria + `channel` (M3, M4) | — | — | Na fila |
| 6 | Custos & Despesas — fatia A | — | — | Na fila |
| 7 | Custos & Despesas — fatia B | — | — | Na fila |
| 8 | Visão Geral | — | — | Na fila |
| 9 | Receitas, Previsões | — | — | Bloqueado (domínio de vendas) |

## Próximos passos

1. Merge do MintlyApi#39 → rodar os comandos de staging abaixo.
2. Fechar a fatia 2 (lib + API) e abrir os dois PRs.
3. Fatia 3 só começa depois de alinhar com a MIN-23 onde o `taxRegime` fica gravado.

## Em aberto (não bloqueia a fatia atual)

- **Bump de versão da lib:** o `ci.yml` da MintlyLib trata `feat!:` como *minor* e ignora o
  rodapé `BREAKING CHANGE:` — só `release:` gera major. A remoção de `predictedReceiptDate`
  saiu como `2.8.0-preview → 2.9.0-preview`. Decidir se corrige o `ci.yml` ou só registra.
- **E2E da capacidade nova da fatia 1:** saída com vencimento e o ida-e-volta do P8 só têm
  cobertura de integração.
- **MintlyWeb × contrato com número cru (N9):** precisa estar combinado antes do Fluxo de Caixa
  substituir o mock.

---

## Comandos pendentes no ambiente

Rodar **de uma vez**, na ordem, depois do merge indicado. Os índices (`db:indices`) **não**
entram aqui: o `deploy.yml` já os roda a cada deploy.

Os scripts conectam pelas mesmas variáveis do app (as do `.env` / da Vercel) e escolhem o banco
por `MONGO_ENV`. O `deploy.yml` usa `vars.MONGO_ENV` quando existe e o nome do environment
quando não — conferir o valor nas Variables do GitHub antes de rodar.

### Staging — depois do merge do MintlyApi#39

```bash
# Fatia 1 (M1): copia predictedReceiptDate → dueDate e remove o índice antigo.
# Idempotente: a segunda execução reporta 0 | 0 | ausente.
MONGO_ENV=staging npm run db:backfill-due-date
```

### Produção — depois da release que levar a fatia 1 para `main`

```bash
MONGO_ENV=production npm run db:backfill-due-date
```

Junto da release: promover a lib (`npm dist-tag add mintly-lib@<versão> latest`) — ver
`Mintly/RELEASE-PROCESS.md`.

### Já rodados

Nenhum ainda. Ao rodar, mover o comando para cá com a data e a saída resumida.
