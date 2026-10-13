# Fatia 3 — Classificação contábil e regime tributário (M2, M5)

`dreGroup` + `mixed` na categoria · regime e alíquota no restaurante · implementa a **MIN-23**

Roteiro geral: `specs/modulos-novos/20260929/design.md` (M2, M5). Este documento detalha a fatia e
corrige o design onde as perguntas de 12/10/2026 decidiram diferente.

---

## Contexto

A fatia 4 (Resultado/DRE) precisa de duas coisas que o modelo não tem:

1. **Separar a despesa por natureza contábil** — CMV, mão de obra, imposto e demais despesas
   operacionais. Hoje a categoria só tem `type`, `behavior` (fixo/variável) e
   `operationalNature`. As telas também mostram um terceiro comportamento, **"Misto"**.
2. **Calcular o imposto sobre a venda** — "(−) Impostos sobre venda" é a receita bruta × alíquota
   efetiva. A alíquota não é digitada: sai da tabela do Simples Nacional (Anexo I) a partir do
   RBT12, como a **MIN-23** especifica. A MIN-23 estava "Em Desenvolvimento" sem código; esta fatia
   a implementa.

Achados no código que moldam o desenho:

- `restaurantSchema` é só `{ name, audit }` e **não existe rota de restaurante** na API — o
  restaurante só nasce no signup. O `RestaurantClient` da lib estende o CRUD genérico de
  `/restaurants`, mas toda rota dele dá 404.
- O onboarding (`register-use-case.ts`) cria 6 categorias de sistema: Venda Balcão, Venda
  Delivery, CMV/Insumos, Salários, Aluguel, Impostos.

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| T1 | O cálculo da MIN-23 é implementado **nesta fatia** | Ninguém tinha começado; a fatia 4 só consome |
| T2 | Regime configurado por **`PATCH /restaurants/me`**, opcional; sem regime o imposto é "não configurado" (0 + aviso) | Não muda o signup; restaurantes existentes caem no mesmo caminho; não inventa número |
| T3 | DAS do MEI em **`app.tax_settings`** com histórico por `validFrom`, semeado por script | "Configurável sem alterar código" (MIN-23); DRE de um mês antigo usa o valor daquele mês |
| T4 | Alertas da MIN-23 como **dado calculado** (`insights`) no `GET /restaurants/me` | Atende os critérios sem criar sistema de notificação |
| T5 | Imposto **calculado na hora**, nada guardado | Alíquota depende só do RBT12 anterior; edição retroativa nunca deixa valor velho |
| T6 | `dreGroup` opcional no cadastro (padrão `opex`), obrigatório no documento gravado | O formulário atual do MintlyWeb não quebra; backfill garante os antigos |
| T7 | A movimentação **não** copia `dreGroup` no snapshot da categoria | Corrigir a classificação tem que valer para o histórico do DRE |

**Correção do design (M5):** o design previa `taxRatePercent` informado como escape hatch e cache da
alíquota no restaurante. Os dois saem: a alíquota é sempre calculada (T5) e o restaurante guarda só
o regime.

**Alternativas recusadas:** regime obrigatório no signup (muda o contrato do onboarding); DAS em
variável de ambiente (troca o valor de todos os meses de uma vez); DAS informado pelo dono (mais um
campo, mesmo problema de padrão); alíquota em cache por job mensal (valor velho após edição
retroativa, mais um cron); snapshot mensal (materialização antes de medir); notificação persistida
(precisa de gatilho e rotas que não existem).

---

## Contrato (MintlyLib)

### Categoria

```ts
export enum CategoryBehavior { Fixed = 'fixed', Variable = 'variable', Mixed = 'mixed' }
export enum DreGroup { Cmv = 'cmv', Labor = 'labor', Tax = 'tax', Opex = 'opex' }

// União discriminada por `type` — o mesmo recurso do financialAccountSchema.
const revenueCategorySchema = baseCategorySchema.extend({ type: s.type().literal(CategoryType.Revenue) })
const expenseCategorySchema = baseCategorySchema.extend({
  type: s.type().literal(CategoryType.Expense),
  dreGroup: s.type().enum(DreGroup),
})
export const financialCategorySchema = s.type().union([revenueCategorySchema, expenseCategorySchema])
```

- **Insert:** `dreGroup?: DreGroup` opcional (a API completa).
- **Update:** objeto achatado `.partial()` com `dreGroup?`; coerência com o tipo gravado é da API.
- Contrato apertado (despesa gravada exige `dreGroup`) → commits com `!` e `BREAKING CHANGE:`.

### Restaurante

```ts
export enum TaxRegime { Mei = 'mei', SimplesNacionalAnexoI = 'simplesNacionalAnexoI' }

export const restaurantSchema = s.object({
  name: s.string(),
  taxRegime: s.type().enum(TaxRegime).optional(),
  audit: auditSchema,
})

// Corpo do PATCH /restaurants/me — estrito, campo desconhecido é rejeitado.
export const restaurantUpdateSchema = s.object({
  name: s.string(),
  taxRegime: s.type().enum(TaxRegime),
}).partial()
```

### Perfil tributário

```ts
export interface TaxBracket { index: number; upTo: number; nominalRate: number; deduction: number }

export interface RestaurantTaxProfile {
  regime: TaxRegime | null
  referenceMonth: string                 // 'AAAA-MM'
  rbt12: number
  monthsOfHistory: number
  rbt12Proportional: boolean
  effectiveRate: number | null           // fração (0.06728); null no MEI e sem regime
  bracket: TaxBracket | null             // só no Simples
  previousBracketIndex: number | null
  meiMonthlyDas: number | null
  meiCap: { annualLimit: number; yearToDateRevenue: number; usedPct: number } | null
  insights: TaxInsight[]
}

export type TaxInsight =
  | { kind: 'bracketChanged'; severity: 'warning'; fromBracket: number; toBracket: number; fromRate: number; toRate: number; rbt12: number }
  | { kind: 'meiCapNear'; severity: 'warning'; usedPct: number; yearToDateRevenue: number; annualLimit: number }
  | { kind: 'simplesLimitExceeded'; severity: 'warning'; rbt12: number }
  | { kind: 'taxRegimeNotConfigured'; severity: 'info' }

export interface RestaurantProfileResponse { restaurant: Restaurant; tax: RestaurantTaxProfile }
export interface RestaurantProfileQuery { month?: string }   // 'AAAA-MM'
```

### `RestaurantClient`

Passa a **compor** o `HttpBaseClient` (regra A10) e expõe só:

- `me(query, headers)` → `GET /restaurants/me`
- `updateMe(body: RestaurantUpdateRequest, headers)` → `PATCH /restaurants/me`

Os métodos de CRUD genérico saem — nunca funcionaram (rotas inexistentes).

---

## Regra tributária

Pura, em `src/app/tax/tax-rules.ts`. Nomes em inglês (convenção do repo); o comentário de cada
função cita o nome da MIN-23 (`calcAliquotaEfetiva` → `effectiveRate`, `calcImpostoVenda` →
`saleTax`).

### Tabela do Anexo I

| Faixa | Até (R$) | Nominal | Dedução (R$) |
|---|---|---|---|
| 1 | 180.000 | 4,00% | 0 |
| 2 | 360.000 | 7,30% | 5.940 |
| 3 | 720.000 | 9,50% | 13.860 |
| 4 | 1.800.000 | 10,70% | 22.500 |
| 5 | 3.600.000 | 14,30% | 87.300 |
| 6 | 4.800.000 | 19,00% | 378.000 |

Limites inclusivos: R$ 180.000,00 é faixa 1; R$ 180.000,01 é faixa 2.

### Alíquota efetiva

```
efetiva = (RBT12 × nominal − dedução) / RBT12
```

- RBT12 = 0 → nominal da faixa 1 (4%).
- RBT12 > 4.800.000 → faixa 6 + insight `simplesLimitExceeded`.
- Alíquota sem arredondamento; imposto em reais arredondado em centavos.

### RBT12 do mês de referência M

- **Fonte:** Σ `grossValue` das **entradas não canceladas** (pendentes contam), por competência
  (`date`), meses no fuso America/Sao_Paulo.
- **Janela:** os 12 meses civis anteriores a M.
- `monthsOfHistory` = meses do mês da primeira movimentação do restaurante até M−1.
- **Proporcional (LC 123, art. 18)**, `rbt12Proportional: true`:
  - `monthsOfHistory = 0` (primeiro mês de atividade) → receita do próprio mês M × 12;
  - `1 ≤ monthsOfHistory ≤ 11` → média mensal dos meses de histórico × 12.
- **Uma consulta:** receita por mês de M−13 até M. Dela saem o RBT12 de M, o de M−1 (faixa
  anterior) e o acumulado do ano.

### MEI

- Imposto do mês = DAS vigente em M: documento de `app.tax_settings` com o maior
  `validFrom ≤ M`. Sem documento → `meiMonthlyDas: null`.
- Teto anual R$ 81.000. No ano de início (primeira movimentação no mesmo ano civil de M, e não
  depois de M), teto proporcional = R$ 6.750 × meses **do início da atividade até dezembro** (LC 123,
  art. 18-A §2º). *Corrigido na revisão final: a versão aprovada dizia "até M", o que gerava alerta
  falso de teto no começo do ano de abertura.*
- `usedPct` = receita bruta de janeiro até o fim de M ÷ teto.

### `saleTax`

```ts
saleTax(value, regime, rbt12)
  // MEI:     { kind: 'fixed', monthlyDas }
  // Simples: { kind: 'variable', effectiveRate, tax }   // tax em centavos arredondados
```

### Insights

| Insight | Quando |
|---|---|
| `bracketChanged` | Simples e faixa de M ≠ faixa de M−1 (M−1 com histórico) |
| `meiCapNear` | MEI e `usedPct ≥ 0,8` (`MEI_CAP_WARNING_PCT`) |
| `simplesLimitExceeded` | Simples e RBT12 > 4.800.000 |
| `taxRegimeNotConfigured` | restaurante sem regime |

Fora de escopo da MIN-23 nesta fatia: impostos nas compras (NF-e, domínio não existe) e margem
líquida por prato (domínio de vendas bloqueado).

---

## API

### Restaurante — `src/app/restaurant/`

- `GET /restaurants/me?month=AAAA-MM` → `{ restaurant, tax }`. `month` opcional (padrão: mês
  corrente em São Paulo); formato inválido ou mês futuro → 400. Restaurante sempre do
  `ctx.restaurantId`.
- `PATCH /restaurants/me` com `{ name?, taxRegime? }` → valida com `restaurantUpdateSchema`;
  atualiza `audit.updatedAt/updatedBy`; devolve o restaurante.
- Sem distinção owner × member (nenhuma rota tem hoje) — pendência registrada.

### Tributário — `src/app/tax/`

- `tax-rules.ts` — regra pura.
- `tax-repository.ts` — receita mensal por competência (índice `{ restaurantId, date }` existente).
- `tax-settings-repository.ts` — DAS vigente em `app.tax_settings` (índice `{ validFrom: -1 }`).
- `tax-profile.query.ts` — monta o `RestaurantTaxProfile`; a fatia 4 reaproveita.

### Categoria

- Regra pura em `category-rules.ts`:
  - tipo final = `changes.type ?? tipo gravado`;
  - final **receita** → `dreGroup` enviado → 400; o gravado é removido;
  - final **despesa** → `changes.dreGroup ?? gravado ?? 'opex'`.
- Cadastro: despesa sem grupo → `opex`; receita com grupo → 400; `mixed` aceito.
- Documento resultante validado pela união da lib.
- Onboarding: CMV/Insumos → `cmv`, Salários → `labor`, Aluguel → `opex`, Impostos → `tax`.

### Scripts

- `npm run db:backfill-dre-group` (`MONGO_ENV`): despesas sem `dreGroup` recebem o grupo pelo nome
  (sistema) ou `opex`. Idempotente.
- `npm run db:seed-tax-settings` (`MEI_MONTHLY_DAS`, `VALID_FROM=AAAA-MM`): grava/atualiza o DAS
  vigente a partir do mês. Sem valor padrão no código. Banco `app` é do cluster: uma execução vale
  para staging e produção.

---

## Testes

**Unitário** — alíquota nas 6 faixas com valores calculados à mão (ex.: RBT12 500.000 → 6,728%);
bordas inclusivas; RBT12 0; acima do limite; RBT12 proporcional (0, 1–11, ≥ 12 meses); `saleTax`
nos dois regimes; teto do MEI cheio e proporcional; `meiCapNear` em 80% e não em 79,9%;
`bracketChanged`; `taxRegimeNotConfigured`; fuso (22h do dia 31 no mês certo); regra da categoria.

**Integração** — `GET /restaurants/me` sem regime, Simples (13 meses, RBT12/alíquota/faixa),
cruzamento de faixa, MEI com DAS e perto do teto, `month` inválido/futuro → 400, sem token → 401;
`PATCH` válido e inválido; isolamento de dois restaurantes no mesmo env; categoria pela API
(cadastro, edição trocando tipo, `mixed`, onboarding); os dois scripts contra Mongo em memória.

**E2E** — configurar regime, lançar receita e ler o perfil por HTTP real.

**Conferência** — `db:seed-demo` ganha o cenário tributário (13 meses, faixa 2 → 3 no mês
corrente) com os números esperados no script.

Threshold de 90% nas quatro métricas.

---

## Entrega

1. **MintlyLib** `feat/20261012/classificacao-contabil` a partir de `staging` — commits com `!`.
2. **MintlyApi** `feat/20261012/classificacao-contabil` a partir de `staging`.

**Comandos no ambiente** (entram no `andamento.md`), depois do merge da API:

```bash
MONGO_ENV=staging npm run db:backfill-dre-group
MEI_MONTHLY_DAS=<DAS 2026> VALID_FROM=2026-01 npm run db:seed-tax-settings   # uma vez por cluster
# produção, na release:
MONGO_ENV=production npm run db:backfill-dre-group
```

---

## Fora de escopo

- DRE (fatia 4); "misto" no ponto de equilíbrio (N8, fatia 4).
- Impostos nas compras (NF-e) e margem por prato.
- Permissão owner × member.
- Notificação persistida dos alertas.
- Regime no signup (o front pode chamar o `PATCH` logo após o cadastro).

---

## Self-review

- **Placeholders:** nenhum. O valor do DAS é parâmetro do script de propósito (T3).
- **Consistência:** a correção do M5 do design está declarada; `simplesLimitExceeded` está no
  contrato e na tabela de insights.
- **Ambiguidade:** "mês" é sempre mês civil em São Paulo; limites de faixa são inclusivos;
  pendentes contam no RBT12 (competência).
- **Escopo:** dois contratos pequenos, uma regra pura, duas rotas, dois scripts — cabe num plano.
