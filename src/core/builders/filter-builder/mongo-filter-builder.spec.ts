import { describe, it, expect, beforeEach } from 'vitest'
import { FilterBuilder } from './mongo-filter-builder'

describe('FilterBuilder', () => {
  let fb: FilterBuilder

  beforeEach(() => {
    fb = new FilterBuilder()
  })

  it('defaultValues gera igualdade direta', () => {
    expect(fb.defaultValues('x', 'name').build()).toEqual({ name: 'x' })
  })

  it('array gera $in', () => {
    expect(fb.array(['a', 'b'], 'tag').build()).toEqual({ tag: { $in: ['a', 'b'] } })
  })

  it('regex usa $options "i" por padrão', () => {
    expect(fb.regex('jo', 'name').build()).toEqual({ name: { $regex: 'jo', $options: 'i' } })
  })

  it('regex aceita options customizado', () => {
    expect(fb.regex('jo', 'name', 'm').build()).toEqual({ name: { $regex: 'jo', $options: 'm' } })
  })

  it('betweenDates gera $gte/$lte como Date', () => {
    const f = fb.betweenDates('2026-01-01', '2026-01-31', 'createdAt').build()
    expect(f.createdAt.$gte).toBeInstanceOf(Date)
    expect(f.createdAt.$lte).toBeInstanceOf(Date)
  })

  it('exists gera $exists/$ne', () => {
    expect(fb.exists(true, 'cpf').build()).toEqual({ cpf: { $exists: true, $ne: null } })
  })

  it('exists aceita notEquals customizado', () => {
    expect(fb.exists(true, 'cpf', '').build()).toEqual({ cpf: { $exists: true, $ne: '' } })
  })

  it('notEqual gera $ne', () => {
    expect(fb.notEqual('x', 'status').build()).toEqual({ status: { $ne: 'x' } })
  })

  it('month cobre o mês inteiro via betweenDates', () => {
    const f = fb.month('2026-03-15', 'date').build()
    expect(f.date.$gte.getUTCMonth()).toBe(2) // março (0-indexed)
    expect(f.date.$gte.getUTCDate()).toBe(1)
    expect(f.date.$lte.getUTCMonth()).toBe(2)
  })

  it('day cobre o dia inteiro', () => {
    const f = fb.day('2026-03-15T10:00:00Z', 'date').build()
    expect(f.date.$gte.getUTCDate()).toBe(15)
    expect(f.date.$gte.getUTCHours()).toBe(0)
    expect(f.date.$lte.getUTCHours()).toBe(23)
  })

  it('encadeia múltiplos campos', () => {
    const f = fb.defaultValues('x', 'a').array(['1'], 'b').build()
    expect(f).toEqual({ a: 'x', b: { $in: ['1'] } })
  })

  it('build limpa o filtro acumulado', () => {
    fb.defaultValues('x', 'a').build()
    expect(fb.build()).toEqual({})
  })
})
