import { describe, expect, it } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { CashFlowMovement } from '../shared/cash-date'
import { buildDueItems, buildProjection, computeCashFlow, buildRealized, criticalDayInsight, groupWeeks, lowestPoint, safetyThreshold, summarizePending } from './cash-flow-metrics'

const TODAY = '2026-10-12'
const at = (day: string) => new Date(`${day}T15:00:00.000Z`)

let seq = 0
function mov (over: Partial<CashFlowMovement> = {}): CashFlowMovement {
  return {
    id: `m${++seq}`,
    title: `Mov ${seq}`,
    category: { _id: 'c1', name: 'Categoria' },
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    date: at('2026-10-01'),
    grossValue: 100,
    netValue: 100,
    ...over,
  }
}

describe('buildProjection', () => {
  it('um ponto por dia, de hoje até hoje + horizonte', () => {
    const points = buildProjection({ today: TODAY, horizon: 3, cashToday: 1000, movements: [] })
    expect(points.map((p) => p.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'])
    expect(points.every((p) => p.balance === 1000)).toBe(true)
  })

  it('acumula entradas (líquido) e saídas (bruto) dia a dia', () => {
    const points = buildProjection({
      today: TODAY,
      horizon: 3,
      cashToday: 1000,
      movements: [
        mov({ direction: MovementDirection.In, grossValue: 500, netValue: 440, dueDate: at('2026-10-13') }),
        mov({ direction: MovementDirection.Out, grossValue: 300, dueDate: at('2026-10-14') }),
      ],
    })
    expect(points.map((p) => p.balance)).toEqual([1000, 1440, 1140, 1140])
    expect(points[1]).toMatchObject({ inflows: 440, outflows: 0 })
    expect(points[2]).toMatchObject({ inflows: 0, outflows: 300 })
  })

  it('vencidas entram hoje', () => {
    const points = buildProjection({ today: TODAY, horizon: 1, cashToday: 1000, movements: [mov({ grossValue: 250, dueDate: at('2026-10-02') })] })
    expect(points[0]).toMatchObject({ balance: 750, outflows: 250 })
  })

  it('ignora liquidadas, canceladas e o que vence depois do horizonte', () => {
    const points = buildProjection({
      today: TODAY,
      horizon: 2,
      cashToday: 1000,
      movements: [
        mov({ status: MovementStatus.Settled, dueDate: at('2026-10-13') }),
        mov({ status: MovementStatus.Cancelled, dueDate: at('2026-10-13') }),
        mov({ dueDate: at('2026-10-30') }),
      ],
    })
    expect(points.map((p) => p.balance)).toEqual([1000, 1000, 1000])
  })

  it('soma em centavos: 0,1 + 0,2 não vira 0,30000000000000004', () => {
    const points = buildProjection({
      today: TODAY,
      horizon: 0,
      cashToday: 0,
      movements: [
        mov({ direction: MovementDirection.In, grossValue: 0.1, netValue: 0.1, dueDate: at(TODAY) }),
        mov({ direction: MovementDirection.In, grossValue: 0.2, netValue: 0.2, dueDate: at(TODAY) }),
      ],
    })
    expect(points[0].balance).toBe(0.3)
  })
})

describe('summarizePending', () => {
  it('a receber e a pagar no horizonte, vencidas incluídas; vencidas também em overdue', () => {
    const summary = summarizePending([
      mov({ direction: MovementDirection.In, grossValue: 500, netValue: 450, dueDate: at('2026-10-20') }),
      mov({ direction: MovementDirection.Out, grossValue: 300, dueDate: at('2026-10-05') }),
      mov({ direction: MovementDirection.In, grossValue: 80, netValue: 80, dueDate: at('2026-10-10') }),
      mov({ direction: MovementDirection.Out, grossValue: 999, dueDate: at('2026-12-01') }),
      mov({ status: MovementStatus.Cancelled, grossValue: 999, dueDate: at('2026-10-13') }),
      mov({ status: MovementStatus.Settled, grossValue: 999, dueDate: at('2026-10-13') }),
    ], TODAY, 30)

    expect(summary).toEqual({ receivable: 530, payable: 300, overdue: { count: 2, receivable: 80, payable: 300 } })
  })

  it('sem movimentações: tudo zero', () => {
    expect(summarizePending([], TODAY, 30)).toEqual({ receivable: 0, payable: 0, overdue: { count: 0, receivable: 0, payable: 0 } })
  })
})

describe('lowestPoint', () => {
  it('menor saldo; empate fica com o primeiro dia', () => {
    const points = [
      { date: 'a', balance: 10, inflows: 0, outflows: 0 },
      { date: 'b', balance: 5, inflows: 0, outflows: 0 },
      { date: 'c', balance: 5, inflows: 0, outflows: 0 },
    ]
    expect(lowestPoint(points)).toEqual({ date: 'b', balance: 5 })
  })
})

describe('groupWeeks', () => {
  it('blocos de 7 dias a partir de hoje; o último pode ser menor', () => {
    const points = buildProjection({ today: TODAY, horizon: 30, cashToday: 0, movements: [mov({ grossValue: 100, dueDate: at('2026-10-05') }), mov({ grossValue: 40, dueDate: at('2026-10-19') })] })

    const weeks = groupWeeks(points)

    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual({ from: '2026-10-12', to: '2026-10-18', inflows: 0, outflows: 100 })
    expect(weeks[1]).toEqual({ from: '2026-10-19', to: '2026-10-25', inflows: 0, outflows: 40 })
    expect(weeks[4]).toEqual({ from: '2026-11-09', to: '2026-11-11', inflows: 0, outflows: 0 })
  })
})

describe('buildRealized', () => {
  it('7 pontos antes de hoje, reconstruídos a partir do caixa de hoje', () => {
    const points = buildRealized({
      today: TODAY,
      cashToday: 9000,
      movements: [
        mov({ status: MovementStatus.Settled, grossValue: 1880, date: at(TODAY), settledAt: at(TODAY) }),
        mov({ status: MovementStatus.Settled, grossValue: 1120, dueDate: at('2026-10-09'), settledAt: at('2026-10-10') }),
        mov({ status: MovementStatus.Settled, direction: MovementDirection.In, grossValue: 2950, netValue: 2950, dueDate: at('2026-10-08') }),
      ],
    })

    expect(points.map((p) => p.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(points.map((p) => p.balance)).toEqual([9050, 9050, 9050, 12000, 12000, 10880, 10880])
    expect(points[3]).toMatchObject({ inflows: 2950, outflows: 0 })
    expect(points[5]).toMatchObject({ inflows: 0, outflows: 1120 })
  })

  it('ignora pendentes', () => {
    const points = buildRealized({ today: TODAY, cashToday: 100, movements: [mov({ dueDate: at('2026-10-10') })] })
    expect(points.every((p) => p.balance === 100)).toBe(true)
  })
})

describe('safetyThreshold', () => {
  it('média sobre 90 dias quando há histórico suficiente', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 54000, firstMovementDay: '2026-07-04' }))
      .toEqual({ value: 4200, days: 7, avgDailyOutflow: 600 })
  })

  it('restaurante novo: divide pelos dias desde a primeira movimentação', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 1000, firstMovementDay: '2026-10-02' }))
      .toEqual({ value: 700, days: 7, avgDailyOutflow: 100 })
  })

  it('primeira movimentação hoje: divisor mínimo 1', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 0, firstMovementDay: TODAY }))
      .toEqual({ value: 0, days: 7, avgDailyOutflow: 0 })
  })

  it('sem nenhuma movimentação: limiar zero', () => {
    expect(safetyThreshold({ today: TODAY, outflowTotal: 0, firstMovementDay: null }))
      .toEqual({ value: 0, days: 7, avgDailyOutflow: 0 })
  })
})

describe('criticalDayInsight', () => {
  const pts = (balances: number[]) => balances.map((balance, i) => ({ date: `d${i}`, balance, inflows: 0, outflows: 0 }))

  it('primeiro dia abaixo do limiar', () => {
    expect(criticalDayInsight(pts([5000, 3000, 1000]), 4200))
      .toEqual({ kind: 'criticalDay', severity: 'warning', date: 'd1', balance: 3000, threshold: 4200 })
  })

  it('o próprio hoje pode ser crítico', () => {
    expect(criticalDayInsight(pts([100, 5000]), 4200)?.date).toBe('d0')
  })

  it('nenhum dia abaixo: sem insight', () => {
    expect(criticalDayInsight(pts([5000, 4200]), 4200)).toBeNull()
  })

  it('limiar zero: só saldo negativo dispara', () => {
    expect(criticalDayInsight(pts([0, 10]), 0)).toBeNull()
    expect(criticalDayInsight(pts([0, -1]), 0)?.date).toBe('d1')
  })
})

describe('buildDueItems', () => {
  it('só movimentação com vencimento, na janela, ordenada por vencimento e título', () => {
    const items = buildDueItems([
      mov({ title: 'Salários', dueDate: at('2026-10-22') }),
      mov({ title: 'Aluguel', dueDate: at('2026-10-22') }),
      mov({ title: 'Embalagens', dueDate: at('2026-10-04') }),
      mov({ title: 'Energia', status: MovementStatus.Settled, dueDate: at('2026-10-09'), settledAt: at('2026-10-10') }),
      mov({ title: 'Antigo pago', status: MovementStatus.Settled, dueDate: at('2026-09-01'), settledAt: at('2026-09-01') }),
      mov({ title: 'À vista', status: MovementStatus.Settled, date: at('2026-10-11'), settledAt: at('2026-10-11') }),
      mov({ title: 'Fora do horizonte', dueDate: at('2026-12-25') }),
      mov({ title: 'Cancelada', status: MovementStatus.Cancelled, dueDate: at('2026-10-15') }),
    ], TODAY, 30)

    expect(items.map((i) => i.title)).toEqual(['Embalagens', 'Energia', 'Aluguel', 'Salários'])
  })

  it('monta o item com valor de caixa, vencida e settledAt', () => {
    const [overdue, settled] = buildDueItems([
      mov({ id: 'p1', title: 'A', grossValue: 730, dueDate: at('2026-10-04') }),
      mov({ id: 's1', title: 'B', direction: MovementDirection.In, grossValue: 3000, netValue: 2950, status: MovementStatus.Settled, dueDate: at('2026-10-08') }),
    ], TODAY, 30)

    expect(overdue).toEqual({
      id: 'p1',
      title: 'A',
      category: { _id: 'c1', name: 'Categoria' },
      direction: 'out',
      amount: 730,
      dueDate: '2026-10-04',
      status: 'pending',
      overdue: true,
      kind: 'movement',
      itemCount: 1,
    })
    expect(settled).toMatchObject({ id: 's1', amount: 2950, status: 'settled', overdue: false, settledAt: '2026-10-08' })
  })
})

describe('buildDueItems — ajuste A5: repasses de plataforma agrupados', () => {
  const ifood = { _id: 'acc-ifood', name: 'iFood', type: 'platform' }
  const rappi = { _id: 'acc-rappi', name: 'Rappi', type: 'platform' }
  const order = (over: Partial<CashFlowMovement>) => mov({ direction: MovementDirection.In, account: ifood, category: { _id: 'v', name: 'Venda Delivery' }, title: 'Pedido', ...over })

  it('pedidos da mesma conta e mesma data viram um item; contas e datas diferentes ficam separadas', () => {
    const items = buildDueItems([
      order({ id: 'a', grossValue: 100, netValue: 77, dueDate: at('2026-10-20') }),
      order({ id: 'b', grossValue: 200, netValue: 154, dueDate: at('2026-10-20') }),
      order({ id: 'c', grossValue: 50, netValue: 38.5, dueDate: at('2026-10-21') }),
      order({ id: 'd', account: rappi, grossValue: 100, netValue: 82, dueDate: at('2026-10-20') }),
      mov({ id: 'e', title: 'Boleto', dueDate: at('2026-10-20'), grossValue: 900 }),
    ], TODAY, 30)

    expect(items.map((i) => [i.title, i.dueDate, i.amount, i.kind, i.itemCount])).toEqual([
      ['Boleto', '2026-10-20', 900, 'movement', 1],
      ['Repasse iFood', '2026-10-20', 231, 'platformPayout', 2],
      ['Repasse Rappi', '2026-10-20', 82, 'platformPayout', 1],
      ['Repasse iFood', '2026-10-21', 38.5, 'platformPayout', 1],
    ])
    expect(items[1]).toMatchObject({ id: 'payout:acc-ifood:2026-10-20:pending', category: { _id: '', name: 'Repasse de plataforma' }, direction: 'in', status: 'pending', overdue: false })
  })

  it('repasse vencido e repasse já recebido (pela data em que caiu)', () => {
    const items = buildDueItems([
      order({ id: 'v', netValue: 10, dueDate: at('2026-10-04') }),
      order({ id: 's1', netValue: 20, status: MovementStatus.Settled, dueDate: at('2026-10-08'), settledAt: at('2026-10-09') }),
      order({ id: 's2', netValue: 30, status: MovementStatus.Settled, dueDate: at('2026-10-08'), settledAt: at('2026-10-09') }),
    ], TODAY, 30)

    expect(items.map((i) => [i.id, i.amount, i.status, i.overdue, i.settledAt ?? null])).toEqual([
      ['payout:acc-ifood:2026-10-04:pending', 10, 'pending', true, null],
      ['payout:acc-ifood:2026-10-09:settled', 50, 'settled', false, '2026-10-09'],
    ])
  })

  it('entrada em conta comum e saída em conta de plataforma não agrupam', () => {
    const items = buildDueItems([
      mov({ id: 'x', direction: MovementDirection.In, account: { _id: 'caixa', name: 'Caixa', type: 'cash' }, dueDate: at('2026-10-20') }),
      mov({ id: 'y', direction: MovementDirection.Out, account: ifood, dueDate: at('2026-10-20') }),
    ], TODAY, 30)
    expect(items.map((i) => i.kind)).toEqual(['movement', 'movement'])
  })
})

describe('computeCashFlow', () => {
  it('monta o relatório e fecha projectedBalance com o último ponto', () => {
    const report = computeCashFlow({
      today: TODAY,
      horizon: 30,
      cashToday: 9000,
      movements: [
        mov({ title: 'Embalagens', grossValue: 730, dueDate: at('2026-10-04') }),
        mov({ title: 'Recebível', direction: MovementDirection.In, grossValue: 2900, netValue: 2900, dueDate: at('2026-10-17') }),
        mov({ title: 'Salários', grossValue: 5400, dueDate: at('2026-10-22') }),
      ],
      outflowHistory: { total: 54000, firstMovementDay: '2026-07-01' },
    })

    expect(report).toMatchObject({
      horizon: 30,
      today: TODAY,
      cashToday: 9000,
      receivable: 2900,
      payable: 6130,
      projectedBalance: 5770,
      lowestBalance: { date: '2026-10-22', balance: 5770 },
      overdue: { count: 1, receivable: 0, payable: 730 },
      safetyThreshold: { value: 4200, days: 7, avgDailyOutflow: 600 },
      insights: [],
    })
    expect(report.projection).toHaveLength(31)
    expect(report.projection[30].balance).toBe(report.projectedBalance)
    expect(report.realized).toHaveLength(7)
    expect(report.weeks).toHaveLength(5)
    expect(report.dueItems.map((i) => i.title)).toEqual(['Embalagens', 'Recebível', 'Salários'])
  })

  it('dia crítico vira insight', () => {
    const report = computeCashFlow({
      today: TODAY,
      horizon: 30,
      cashToday: 5000,
      movements: [mov({ grossValue: 2000, dueDate: at('2026-10-15') })],
      outflowHistory: { total: 54000, firstMovementDay: '2026-07-01' },
    })
    expect(report.insights).toEqual([{ kind: 'criticalDay', severity: 'warning', date: '2026-10-15', balance: 3000, threshold: 4200 }])
  })

  it('restaurante sem nenhuma movimentação: tudo zero, sem quebrar', () => {
    const report = computeCashFlow({ today: TODAY, horizon: 30, cashToday: 0, movements: [], outflowHistory: { total: 0, firstMovementDay: null } })
    expect(report).toMatchObject({ receivable: 0, payable: 0, projectedBalance: 0, lowestBalance: { date: TODAY, balance: 0 }, dueItems: [], insights: [] })
  })
})
