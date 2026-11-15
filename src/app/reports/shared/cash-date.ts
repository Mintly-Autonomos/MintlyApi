import { FinancialAccountType, MovementDirection, MovementStatus } from 'mintly-lib'
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
  /** Conta (snapshot) — usada para agrupar repasses de plataforma (ajuste A5). */
  account?: { _id: string; name: string; type: string }
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

/**
 * Vencida = pendente cujo vencimento (ou, sem vencimento, a data do lançamento) já passou. Vencer hoje ainda não
 * é atraso. Repasse de plataforma (iFood, maquininha) não fica "em atraso": ele cai sozinho, e marcar como
 * atrasado só gera alarme falso.
 */
export function isOverdue (m: CashFlowMovement, today: string): boolean {
  if (m.status !== MovementStatus.Pending) return false
  if (m.direction === MovementDirection.In && m.account?.type === FinancialAccountType.Platform) return false
  return toLocalDay(m.dueDate ?? m.date) < today
}
