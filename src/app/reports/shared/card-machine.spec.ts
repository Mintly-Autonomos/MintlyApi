import { describe, expect, it } from 'vitest'
import { CategoryBehavior, FinancialAccountType, MovementChannel, MovementDirection, PaymentMethod, PlatformKind } from 'mintly-lib'
import { effectiveChannel } from './channel'
import { computeSnapshot } from '../../financial-movement/movement-rules'
import { assertAccountUpdateAllowed } from '../../financial-account/account-rules'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { MonthlyTotalRow, aggregateMonth, buildLines, buildOpexItems, hasActivity } from '../result/result-metrics'
import { ExpenseRow, computeExpenses } from '../expenses/expenses-metrics'

const stone = {
  type: FinancialAccountType.Platform,
  feePercent: 2.5,
  settlementDays: 0,
  platformKind: PlatformKind.CardMachine,
  feeByMethod: { debit: 1, credit: 3 },
}

describe('maquininha e taxa por forma de pagamento (S3.3)', () => {
  it('computeSnapshot: a taxa da forma; sem forma ou sem taxa própria, a da conta; congelada vence', () => {
    const base = { direction: MovementDirection.In, grossValue: 1_000, date: new Date('2026-11-10T15:00:00Z'), account: stone }
    expect(computeSnapshot({ ...base, paymentMethod: PaymentMethod.Credit })).toMatchObject({ feeValue: 30, netValue: 970, feePercentApplied: 3 })
    expect(computeSnapshot({ ...base, paymentMethod: PaymentMethod.Pix })).toMatchObject({ feeValue: 25, feePercentApplied: 2.5 })
    expect(computeSnapshot(base)).toMatchObject({ feeValue: 25 })
    expect(computeSnapshot({ ...base, paymentMethod: PaymentMethod.Credit, fee: { percent: 4, settlementDays: 0 } })).toMatchObject({ feeValue: 40 })
    expect(computeSnapshot({ ...base, direction: MovementDirection.Out, paymentMethod: PaymentMethod.Credit })).toEqual({ feeValue: 0, netValue: 1_000 })
  })

  it('canal padrão: venda na maquininha é salão; no app, delivery; o informado vence', () => {
    const inn = (account: { type: string; platformKind?: string | null }, channel?: MovementChannel) => effectiveChannel({ direction: MovementDirection.In, account, channel })
    expect(inn({ type: 'platform', platformKind: PlatformKind.CardMachine })).toBe(MovementChannel.DineIn)
    expect(inn({ type: 'platform', platformKind: PlatformKind.Marketplace })).toBe(MovementChannel.Delivery)
    expect(inn({ type: 'platform' })).toBe(MovementChannel.Delivery)
    expect(inn({ type: 'platform', platformKind: PlatformKind.CardMachine }, MovementChannel.Delivery)).toBe(MovementChannel.Delivery)
  })

  it('PATCH: tipo de plataforma e taxa por forma só em conta plataforma', () => {
    expect(() => assertAccountUpdateAllowed('bank', { platformKind: PlatformKind.CardMachine })).toThrow(ConflictError)
    expect(() => assertAccountUpdateAllowed('cash', { feeByMethod: { pix: 1 } })).toThrow(ConflictError)
    expect(() => assertAccountUpdateAllowed('platform', { platformKind: PlatformKind.CardMachine, feeByMethod: { pix: 1 } })).not.toThrow()
  })

  it('Resultado: a taxa da maquininha é linha própria e entra na despesa operacional e no variável', () => {
    const M = '2026-10'
    const row = (over: Partial<MonthlyTotalRow>): MonthlyTotalRow => ({ month: M, direction: 'in', categoryId: 'v', categoryName: 'Vendas', gross: 0, fee: 0, ...over })
    const rows = [row({ gross: 1_000, fee: 30, cardMachine: true }), row({ gross: 500, fee: 60 })]
    const agg = aggregateMonth(rows, M, new Map())
    expect(agg).toMatchObject({ cardFee: 3_000, platformFee: 6_000, variable: 9_000 })
    expect(buildLines(agg, { effectiveRate: null, fixedAmount: null })).toMatchObject({ operatingExpenses: 90, netProfit: 1_410 })
    const items = buildOpexItems(agg, aggregateMonth([], M, new Map()))
    expect(items.map((i) => [i.kind, i.name, i.amount])).toEqual([['platformFee', 'Taxa de plataforma', 60], ['cardFee', 'Taxa da maquininha', 30]])
    expect(hasActivity({ ...aggregateMonth([], M, new Map()), cardFee: 1 })).toBe(true)
  })

  it('Custos: taxa da maquininha com a base dela; a comissão dos apps só com a receita dos apps', () => {
    const M = '2026-10'
    const row = (over: Partial<ExpenseRow>): ExpenseRow => ({
      month: M, direction: 'in', categoryId: 'v', categoryName: 'Vendas', accountId: 'stone', accountName: 'Stone', accountType: 'platform', channel: null, subcategoryId: null, subcategoryName: null, gross: 0, fee: 0, ...over,
    })
    const rows = [row({ gross: 1_000, fee: 30 }), row({ accountId: 'ifood', accountName: 'iFood', gross: 500, fee: 60 }), row({ month: '2026-09', gross: 800, fee: 20 })]
    const input = { referenceMonth: M, rows, categories: new Map([['v', { name: 'Vendas', behavior: CategoryBehavior.Variable }]]), accountNames: new Map(), cardMachines: new Set(['stone']), firstMonth: '2026-09', today: new Date('2026-11-20T12:00:00Z') }
    const e = computeExpenses({ ...input, channel: null })
    expect(e.cardFee).toMatchObject({ amount: 30, previous: 20, cardRevenue: 1_000, pctOfCardRevenue: 0.03 })
    expect(e.cardFee.deltaPrevious).toBeCloseTo(0.5, 10)
    expect(e.platformFee).toMatchObject({ amount: 60, deliveryRevenue: 500, pctOfDelivery: 0.12 })
    expect(e.items.map((i) => [i.key, i.kind])).toEqual([['platformFee:ifood', 'platformFee'], ['cardFee:stone', 'cardFee']])
    const salao = computeExpenses({ ...input, channel: MovementChannel.DineIn })
    expect(salao.revenue.current).toBe(1_000)
    expect(salao.items.map((i) => i.key)).toEqual(['cardFee:stone'])
    // Sem a lista de maquininhas (chamadas antigas), tudo continua como app.
    const { cardMachines: _c, ...semLista } = input
    expect(computeExpenses({ ...semLista, channel: null }).cardFee.amount).toBe(0)
  })
})
