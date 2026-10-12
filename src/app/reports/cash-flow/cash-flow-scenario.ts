import { Decimal128 } from 'mongodb'
import { toDecimal128 } from '../../../core/money/money'
import { addDaysToDay, startOfLocalDay } from '../shared/period'

/**
 * Cenário determinístico do Fluxo de Caixa, relativo a "hoje" (d0). Serve ao
 * teste de integração E ao `npm run db:seed-demo` — os dois conferem os mesmos
 * números, então não divergem.
 *
 * Conta ativa com R$ 9.000 disponível; conta inativa com R$ 50.000 (não entra).
 *
 *   Liquidadas
 *   S1 entrada  1.000  date d-100               (primeira movimentação)
 *   S2 saída   52.880  date d-60                (histórico de saída)
 *   S3 saída    1.120  vence d-3, pago em d-2   (Energia — pago com atraso)
 *   S4 entrada  2.950  vence d-4, recebido d-4  (Repasse iFood)
 *   S5 saída    1.880  à vista hoje
 *   Pendentes
 *   P1 saída      730  vence d-8   (vencida)
 *   P2 saída      620  vence d-2   (vencida)
 *   P3 entrada  2.900  vence d+5
 *   P4 saída    2.200  vence d+10  (Aluguel)
 *   P5 saída    5.400  vence d+10  (Salários)
 *   P6 entrada  3.600  vence d+12
 *   P7 saída    1.000  vence d+40  (só no horizonte de 60)
 *   C1 saída    5.000  vence d+3   (cancelada — não aparece em nada)
 *
 * Histórico de saída [d-90, d0): S2 + S3 = 54.000 em 90 dias → 600/dia → margem 4.200.
 * Projeção (h30): d0 = 9.000 − 730 − 620 = 7.650; d5 = 10.550; d10 = 2.950 (menor
 * saldo e dia crítico, abaixo de 4.200); d12 em diante = 6.550.
 * Realizada: fim de ontem = 9.000 + 1.880 = 10.880; d-2 paga 1.120 → 12.000 antes;
 * d-4 recebe 2.950 → 9.050 antes.
 */
export const SEED_MARKER = 'seed-demo:cash-flow'

export interface ScenarioRefs {
  restaurantId: string
  account: { _id: string; name: string; type: string }
  revenueCategory: { _id: string; name: string }
  expenseCategory: { _id: string; name: string }
}

const audit = () => ({ createdAt: new Date(), updatedAt: new Date() })

export function cashFlowScenarioAccounts (restaurantId: string): Record<string, unknown>[] {
  return [
    { restaurantId, name: 'Demo · Caixa', type: 'cash', status: 'active', isDefault: false, availableBalance: toDecimal128(9000), predictedBalance: toDecimal128(0), audit: audit() },
    { restaurantId, name: 'Demo · Conta encerrada', type: 'bank', status: 'inactive', isDefault: false, availableBalance: toDecimal128(50000), predictedBalance: toDecimal128(0), audit: audit() },
  ]
}

interface Line {
  title: string
  direction: 'in' | 'out'
  status: 'pending' | 'settled' | 'cancelled'
  gross: number
  date: number
  due?: number
  settled?: number
}

const LINES: Line[] = [
  { title: 'Venda inaugural', direction: 'in', status: 'settled', gross: 1000, date: -100, settled: -100 },
  { title: 'Fornecedor Carnes (trimestral)', direction: 'out', status: 'settled', gross: 52880, date: -60, settled: -60 },
  { title: 'Energia elétrica', direction: 'out', status: 'settled', gross: 1120, date: -10, due: -3, settled: -2 },
  { title: 'Repasse iFood', direction: 'in', status: 'settled', gross: 2950, date: -34, due: -4, settled: -4 },
  { title: 'Compra no mercado', direction: 'out', status: 'settled', gross: 1880, date: 0, settled: 0 },
  { title: 'Fornecedor Embalagens', direction: 'out', status: 'pending', gross: 730, date: -20, due: -8 },
  { title: 'Taxas de cartão', direction: 'out', status: 'pending', gross: 620, date: -5, due: -2 },
  { title: 'Recebível cartão de crédito', direction: 'in', status: 'pending', gross: 2900, date: -1, due: 5 },
  { title: 'Aluguel do ponto', direction: 'out', status: 'pending', gross: 2200, date: 0, due: 10 },
  { title: 'Salários — 2ª parcela', direction: 'out', status: 'pending', gross: 5400, date: 0, due: 10 },
  { title: 'Repasse iFood — quinzena', direction: 'in', status: 'pending', gross: 3600, date: 0, due: 12 },
  { title: 'Fornecedor Hortifruti', direction: 'out', status: 'pending', gross: 1000, date: 0, due: 40 },
  { title: 'Compra cancelada', direction: 'out', status: 'cancelled', gross: 5000, date: 0, due: 3 },
]

export function cashFlowScenarioMovements (today: string, refs: ScenarioRefs): Record<string, unknown>[] {
  // Meio-dia local: longe da virada do dia em qualquer fuso de teste.
  const at = (offset: number) => new Date(startOfLocalDay(addDaysToDay(today, offset)).getTime() + 12 * 60 * 60 * 1000)

  return LINES.map((l) => {
    const money: Decimal128 = toDecimal128(l.gross)
    const doc: Record<string, unknown> = {
      restaurantId: refs.restaurantId,
      title: l.title,
      direction: l.direction,
      status: l.status,
      statusSource: 'auto',
      date: at(l.date),
      grossValue: money,
      feeValue: toDecimal128(0),
      netValue: money,
      account: refs.account,
      category: l.direction === 'in'
        ? { ...refs.revenueCategory, type: 'revenue' }
        : { ...refs.expenseCategory, type: 'expense' },
      paymentMethod: 'pix',
      origin: 'manual',
      description: SEED_MARKER,
      history: [],
      audit: audit(),
    }
    if (l.due != null) doc.dueDate = at(l.due)
    if (l.settled != null) doc.settledAt = at(l.settled)
    return doc
  })
}

/** O que o endpoint TEM que devolver para o cenário acima. */
export function cashFlowScenarioExpected (today: string, horizon: 30 | 60) {
  const d = (offset: number) => addDaysToDay(today, offset)
  const dueTitles30 = [
    'Fornecedor Embalagens',
    'Repasse iFood',
    'Energia elétrica',
    'Taxas de cartão',
    'Recebível cartão de crédito',
    'Aluguel do ponto',
    'Salários — 2ª parcela',
    'Repasse iFood — quinzena',
  ]

  return {
    cashToday: 9000,
    receivable: 6500,
    payable: horizon === 30 ? 8950 : 9950,
    projectedBalance: horizon === 30 ? 6550 : 5550,
    lowestBalance: { date: d(10), balance: 2950 },
    overdue: { count: 2, receivable: 0, payable: 1350 },
    safetyThreshold: { value: 4200, days: 7, avgDailyOutflow: 600 },
    insights: [{ kind: 'criticalDay', severity: 'warning', date: d(10), balance: 2950, threshold: 4200 }],
    projectionLength: horizon + 1,
    realizedBalances: [9050, 9050, 9050, 12000, 12000, 10880, 10880],
    week1: { from: d(0), to: d(6), inflows: 2900, outflows: 1350 },
    dueItemTitles: horizon === 30 ? dueTitles30 : [...dueTitles30, 'Fornecedor Hortifruti'],
  }
}
