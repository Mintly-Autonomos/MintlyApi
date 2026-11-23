import { addMonths } from '../reports/shared/period'
import { fromCents, toCents } from '../../core/money/money'

/**
 * Histórico que o imposto usa (reteste 22/11, T1 e T2) — puro.
 *
 * - **Início da atividade** (CGSN 140/2018, art. 22): o `activityStart` que o dono informou ou, sem ele, o mês da
 *   primeira venda no Mintly. Com a empresa aberta antes do Mintly, os meses entre a abertura e a primeira venda
 *   no Mintly usam o faturamento informado (`revenueBeforeMintly`); o mês sem valor informado é DESCONHECIDO e fica
 *   fora da média (não vira receita zero, que baixaria o RBT12).
 * - **DAS do MEI**: valor fixo por mês. O configurado (`tax_settings`) vale; sem ele, o DAS típico, a mediana dos
 *   DAS pagos nos 12 meses até o mês de referência. Antes o imposto era o DAS PAGO no mês: com 2 DAS pagos em
 *   novembro, o imposto do mês dobrava e as outras telas o transformavam em porcentagem das vendas.
 */
export interface TaxHistory {
  firstMonth: string | null
  revenueByMonth: Map<string, number>
  /** Meses entre a abertura e o Mintly sem faturamento informado: ficam fora da média do RBT12. */
  unknownMonths: Set<string>
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function buildTaxHistory (p: {
  firstRevenueMonth: string | null
  revenueByMonth: Map<string, number>
  activityStart?: string | null
  revenueBeforeMintly?: { month: string, amount: number }[] | null
}): TaxHistory {
  const start = p.activityStart && MONTH.test(p.activityStart) ? p.activityStart : null
  const firstMonth = start && (!p.firstRevenueMonth || start < p.firstRevenueMonth) ? start : p.firstRevenueMonth
  const revenueByMonth = new Map(p.revenueByMonth)
  const informed = new Set<string>()
  for (const r of p.revenueBeforeMintly ?? []) {
    if (!MONTH.test(r.month) || !(r.amount >= 0)) continue
    // Mês que já tem venda no Mintly: vale o que foi lançado.
    if (p.firstRevenueMonth && r.month >= p.firstRevenueMonth) continue
    if (firstMonth && r.month < firstMonth) continue
    revenueByMonth.set(r.month, r.amount)
    informed.add(r.month)
  }
  // Até onde vai o "antes do Mintly": a primeira venda lançada ou, sem nenhuma, o mês seguinte ao último informado.
  const lastInformed = [...informed].sort().pop()
  const boundary = p.firstRevenueMonth ?? (lastInformed ? addMonths(lastInformed, 1) : null)
  const unknownMonths = new Set<string>()
  if (firstMonth && boundary && firstMonth < boundary) {
    for (let m = firstMonth; m < boundary; m = addMonths(m, 1)) if (!informed.has(m)) unknownMonths.add(m)
  }
  return { firstMonth, revenueByMonth, unknownMonths }
}

/** O DAS típico: a mediana dos pagamentos (cada DAS, não a soma do mês). null sem pagamento. */
export function typicalDas (payments: number[]): number | null {
  const v = payments.filter((x) => x > 0).map(toCents).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return fromCents(v.length % 2 === 1 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2))
}
