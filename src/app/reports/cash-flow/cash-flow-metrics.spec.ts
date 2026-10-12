import { describe, expect, it } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { CashFlowMovement } from '../shared/cash-date'
import { buildProjection, groupWeeks, lowestPoint, summarizePending } from './cash-flow-metrics'

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
