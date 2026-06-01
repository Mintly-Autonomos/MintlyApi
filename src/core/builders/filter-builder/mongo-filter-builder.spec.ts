import { describe, it, expect } from 'vitest'
import { FilterBuilder } from './mongo-filter-builder'

describe('FilterBuilder', () => {
  it('defaultValues seta filter direto', () => {
    const result = new FilterBuilder().defaultValues('Ada', 'name').build()
    expect(result).toEqual({ name: 'Ada' })
  })

  it('array usa $in', () => {
    const result = new FilterBuilder().array(['a', 'b'], 'tag').build()
    expect(result).toEqual({ tag: { $in: ['a', 'b'] } })
  })

  it('regex monta $regex com options padrão "i"', () => {
    const result = new FilterBuilder().regex('ada', 'name').build()
    expect(result).toEqual({ name: { $regex: 'ada', $options: 'i' } })
  })

  it('regex aceita options customizados', () => {
    const result = new FilterBuilder().regex('ada', 'name', 'm').build()
    expect(result.name.$options).toBe('m')
  })

  it('betweenDates monta $gte / $lte com Date', () => {
    const result = new FilterBuilder().betweenDates('2024-01-01', '2024-12-31', 'createdAt').build()
    expect(result.createdAt.$gte).toBeInstanceOf(Date)
    expect(result.createdAt.$lte).toBeInstanceOf(Date)
  })

  it('exists monta $exists e $ne', () => {
    const result = new FilterBuilder().exists(true, 'email').build()
    expect(result).toEqual({ email: { $exists: true, $ne: null } })
  })

  it('exists aceita notEquals custom', () => {
    const result = new FilterBuilder().exists(false, 'email', '').build()
    expect(result.email.$ne).toBe('')
  })

  it('month monta janela do mês inteiro em UTC', () => {
    const result = new FilterBuilder().month('2024-03-15', 'createdAt').build()
    const gte = result.createdAt.$gte as Date
    const lte = result.createdAt.$lte as Date
    expect(gte.getUTCDate()).toBe(1)
    expect(gte.getUTCMonth()).toBe(2) // março = índice 2
    expect(lte.getUTCMonth()).toBe(2)
    expect(lte.getUTCDate()).toBe(31)
  })

  it('day monta janela de 24h em UTC', () => {
    const result = new FilterBuilder().day('2024-03-15', 'createdAt').build()
    const gte = result.createdAt.$gte as Date
    const lte = result.createdAt.$lte as Date
    expect(gte.getUTCHours()).toBe(0)
    expect(lte.getUTCHours()).toBe(23)
    expect(gte.getUTCDate()).toBe(15)
    expect(lte.getUTCDate()).toBe(15)
  })

  it('notEqual usa $ne', () => {
    const result = new FilterBuilder().notEqual('x', 'name').build()
    expect(result).toEqual({ name: { $ne: 'x' } })
  })

  it('build limpa o filter para o próximo uso', () => {
    const builder = new FilterBuilder()
    builder.defaultValues('Ada', 'name').build()
    const second = builder.defaultValues('Bob', 'name').build()
    expect(second).toEqual({ name: 'Bob' })
  })

  it('chainable: setters retornam this', () => {
    const builder = new FilterBuilder()
    expect(builder.defaultValues(1, 'a')).toBe(builder)
    expect(builder.array([], 'b')).toBe(builder)
    expect(builder.regex('x', 'c')).toBe(builder)
    expect(builder.exists(true, 'd')).toBe(builder)
    expect(builder.notEqual('e', 'f')).toBe(builder)
  })
})
