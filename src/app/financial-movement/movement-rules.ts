import { FinancialAccountType, MovementDirection, MovementStatus } from 'mintly-lib'
import { computeFeeNet } from '../../core/money/money'

/**
 * Regras puras de domínio da movimentação (MIN-49/50) — sem Mongo, testáveis
 * isoladamente. Dinheiro aqui é `number` de domínio; a conversão p/ Decimal128
 * acontece na borda de persistência (repository).
 */

/** Subset da conta financeira necessário às regras (snapshot/saldo). */
export interface AccountForRules {
  type: string
  feePercent?: number
  settlementDays?: number
}

/** Soma `days` dias corridos a uma data (não muta a original). */
export function addDays (date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * Única fonte de verdade p/ "conta com liquidação via plataforma": só contas
 * `platform` cobram taxa (`feePercent`) e têm prazo (`settlementDays`) — o schema
 * (união discriminada) garante isso. É também o sinal que o settler usa para
 * saber o que pode liquidar sozinho: repasse de plataforma cai na data, boleto
 * não se paga sozinho.
 */
export function isPlatformAccount (account: AccountForRules): boolean {
  return account.type === FinancialAccountType.Platform
}

/**
 * Status default (M1): **tem vencimento → `pending`; não tem → `settled`**. Uma
 * regra só, sem olhar direção nem tipo de conta.
 *
 * Repare que a regra olha a PRESENÇA do vencimento, não se ele já passou. Uma
 * saída lançada hoje com vencimento de ontem nasce `pending` e aparece como
 * vencida — vencer não é pagar, e quem diz que pagou é o dono, pelo
 * `PATCH /:id/status`. Se a data mandasse, o bloco "Vencidos" do Fluxo de Caixa
 * nunca teria conteúdo.
 *
 * Entrada em conta `platform` com prazo mantém o comportamento de sempre: o
 * `computeSnapshot` gera o vencimento e ela nasce `pending`. Prazo zero não gera
 * vencimento, então continua nascendo `settled`.
 *
 * Substitui a regra antiga, que só conhecia "entrada de plataforma com prazo" e
 * por isso não tinha como representar conta a pagar.
 */
export function defaultStatus (params: { dueDate?: Date | null }): MovementStatus {
  return params.dueDate != null ? MovementStatus.Pending : MovementStatus.Settled
}

export interface MovementSnapshot {
  feeValue: number
  netValue: number
  feePercentApplied?: number
  settlementDaysApplied?: number
  /** Vencimento calculado pela conta com prazo. Ver `dueDate` no schema da lib. */
  dueDate?: Date
}

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
 * em conta `platform` (receber via plataforma desconta a taxa). Saídas e contas
 * não-platform: `feeValue = 0`, `netValue = grossValue`, sem data prevista.
 *
 * `fee` (P3): quando informado, é a taxa/prazo CONGELADOS no lançamento — usados
 * na edição para que editar um campo inócuo (ex.: título) não re-precifique o
 * movimento com a taxa ATUAL da conta. Ausente (`undefined`): deriva da conta
 * viva (registro).
 *
 * IMPORTANTE — `fee` é tudo-ou-nada: quando `fee` vem, ele é o snapshot
 * completo; ausência de um campo DENTRO dele significa "não havia" (ex.:
 * movimento antigo sem prazo registrado), não "busque na conta". Nenhum campo
 * de `fee` cai individualmente de volta na conta viva — o fallback para a
 * conta só acontece quando `fee` inteiro é `undefined`.
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
    const percent = fee != null ? fee.percent : account.feePercent
    const settlementDays = fee != null ? fee.settlementDays : account.settlementDays

    const { feeValue, netValue } = computeFeeNet(grossValue, percent)
    const snapshot: MovementSnapshot = {
      feeValue,
      netValue,
      feePercentApplied: percent,
    }
    if (settlementDays != null) {
      snapshot.settlementDaysApplied = settlementDays

      // Prazo ZERO é "cai na hora": registra o prazo aplicado, mas NÃO gera
      // vencimento. Sem esta guarda o movimento nasceria `pending` com
      // vencimento igual à data do lançamento — o oposto do que a conta de
      // prazo zero faz hoje (`defaultStatus` exigia `settlementDays > 0`).
      if (settlementDays > 0) {
        snapshot.dueDate = addDays(date, settlementDays)
      }
    }
    return snapshot
  }

  return { feeValue: 0, netValue: grossValue }
}

/**
 * Qual vencimento vale no documento resultante, na ordem de precedência:
 *
 * 1. O que o dono informou nesta escrita (`null` = limpar, "é à vista agora").
 * 2. O calculado pela conta com prazo — segue a conta e a data do lançamento.
 * 3. O que já estava gravado, **desde que não tenha vindo de conta com prazo**.
 *
 * A condição do item 3 é a que mantém o boleto inteiro. Um vencimento informado
 * pelo dono pertence ao lançamento e sobrevive a qualquer troca de conta — mover
 * um boleto de uma conta bancária para outra não pode apagar a data em que ele
 * vence. Já um vencimento derivado de repasse pertence à conta antiga: quando o
 * movimento sai dela, a data deixa de significar alguma coisa e tem que sumir. É
 * isso que faz o recebível voltar a ser dinheiro em caixa (P8).
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
 * o vencimento e ele volta a `settled`. E é o que protege o boleto vencido —
 * corrigir a data de uma conta não paga não pode marcá-la como paga.
 *
 * `manual` é soberano (ação humana anterior), `cancelled` nunca é recomputado
 * (reverter cancelado é no-op e aplicar liquidado credita o líquido: o saldo
 * nasceria do nada), e uma edição que mexeu no status explicitamente já disse o
 * que queria.
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

export type BalanceBucket = 'available' | 'predicted'

export interface BalanceImpact {
  /** Bucket do saldo afetado; `null` quando não há impacto (cancelled). */
  bucket: BalanceBucket | null
  /** Valor com sinal (em reais): +netValue para entrada, −grossValue para saída. */
  delta: number
}

/**
 * Impacto no saldo da conta:
 *  - `settled` → bucket `available`; `pending` → bucket `predicted`;
 *    `cancelled` → sem impacto.
 *  - sinal: entrada soma `netValue`; saída subtrai `grossValue`.
 */
export function balanceImpact (params: {
  direction: MovementDirection
  status: MovementStatus
  grossValue: number
  netValue: number
}): BalanceImpact {
  const { direction, status, grossValue, netValue } = params

  if (status === MovementStatus.Cancelled) {
    return { bucket: null, delta: 0 }
  }

  const delta = direction === MovementDirection.In ? netValue : -grossValue
  const bucket: BalanceBucket = status === MovementStatus.Settled ? 'available' : 'predicted'

  return { bucket, delta }
}
