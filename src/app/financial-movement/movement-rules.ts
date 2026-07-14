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
 * (união discriminada) garante isso. `defaultStatus` e `computeSnapshot` decidem
 * pelo MESMO sinal, evitando divergência (ex.: pendente sem data prevista).
 */
export function isPlatformAccount (account: AccountForRules): boolean {
  return account.type === FinancialAccountType.Platform
}

/**
 * Status default: **entrada** em conta `platform` com prazo (`settlementDays > 0`)
 * → `pending` (o recebimento só cai depois); demais casos → `settled`. Prazo só
 * vale p/ recebimento — saídas nunca ficam pendentes por liquidação. O usuário
 * pode sobrescrever depois.
 */
export function defaultStatus (params: {
  direction: MovementDirection
  account: AccountForRules
}): MovementStatus {
  const { direction, account } = params
  const platformInflowWithDelay =
    direction === MovementDirection.In &&
    isPlatformAccount(account) &&
    account.settlementDays != null &&
    account.settlementDays > 0

  return platformInflowWithDelay ? MovementStatus.Pending : MovementStatus.Settled
}

export interface MovementSnapshot {
  feeValue: number
  netValue: number
  feePercentApplied?: number
  settlementDaysApplied?: number
  predictedReceiptDate?: Date
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
      snapshot.predictedReceiptDate = addDays(date, settlementDays)
    }
    return snapshot
  }

  return { feeValue: 0, netValue: grossValue }
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
