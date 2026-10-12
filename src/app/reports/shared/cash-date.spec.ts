import { describe, expect, it } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { CashFlowMovement, cashAmount, cashDay, isOverdue } from './cash-date'

const TODAY = '2026-10-12'
// 15h UTC = 12h em São Paulo: longe da virada do dia.
const at = (day: string) => new Date(`${day}T15:00:00.000Z`)

function mov (over: Partial<CashFlowMovement> = {}): CashFlowMovement {
  return {
    id: 'm1',
    title: 'Boleto',
    category: { _id: 'c1', name: 'Fornecedores' },
    direction: MovementDirection.Out,
    status: MovementStatus.Pending,
    date: at('2026-10-01'),
    grossValue: 100,
    netValue: 100,
    ...over,
  }
}

describe('cashDay', () => {
  it('pendente com vencimento futuro: o dia do vencimento', () => {
    expect(cashDay(mov({ dueDate: at('2026-10-20') }), TODAY)).toBe('2026-10-20')
  })

  it('pendente vencida: conta hoje', () => {
    expect(cashDay(mov({ dueDate: at('2026-10-03') }), TODAY)).toBe(TODAY)
  })

  it('pendente sem vencimento (dono forçou): a data do lançamento, ou hoje se passou', () => {
    expect(cashDay(mov({ date: at('2026-10-15') }), TODAY)).toBe('2026-10-15')
    expect(cashDay(mov({ date: at('2026-10-01') }), TODAY)).toBe(TODAY)
  })

  it('liquidada: settledAt vence dueDate e date', () => {
    expect(cashDay(mov({ status: MovementStatus.Settled, dueDate: at('2026-10-05'), settledAt: at('2026-10-08') }), TODAY)).toBe('2026-10-08')
  })

  it('liquidada sem settledAt (documento antigo): dueDate, senão date — sem puxar para hoje', () => {
    expect(cashDay(mov({ status: MovementStatus.Settled, dueDate: at('2026-10-05') }), TODAY)).toBe('2026-10-05')
    expect(cashDay(mov({ status: MovementStatus.Settled }), TODAY)).toBe('2026-10-01')
  })

  it('vencimento às 22h30 em São Paulo fica no próprio dia', () => {
    expect(cashDay(mov({ dueDate: new Date('2026-10-21T01:30:00.000Z') }), TODAY)).toBe('2026-10-20')
  })
})

describe('cashAmount', () => {
  it('entrada vale o líquido; saída vale o bruto', () => {
    expect(cashAmount(mov({ direction: MovementDirection.In, grossValue: 100, netValue: 88 }))).toBe(88)
    expect(cashAmount(mov({ direction: MovementDirection.Out, grossValue: 100, netValue: 100 }))).toBe(100)
  })
})

describe('isOverdue', () => {
  it('pendente com vencimento antes de hoje', () => {
    expect(isOverdue(mov({ dueDate: at('2026-10-11') }), TODAY)).toBe(true)
  })

  it('vence hoje não está vencida', () => {
    expect(isOverdue(mov({ dueDate: at(TODAY) }), TODAY)).toBe(false)
  })

  it('liquidada nunca está vencida; sem vencimento também não', () => {
    expect(isOverdue(mov({ status: MovementStatus.Settled, dueDate: at('2026-10-01') }), TODAY)).toBe(false)
    expect(isOverdue(mov({ date: at('2026-10-01') }), TODAY)).toBe(false)
  })
})
