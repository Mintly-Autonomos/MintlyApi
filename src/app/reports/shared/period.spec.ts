import { describe, expect, it } from 'vitest'
import { addDaysToDay, addMonths, diffDays, diffMonths, parseGmtOffset, startOfLocalDay, startOfLocalMonth, toLocalDay, toLocalMonth, parseReferenceMonth, comparisonUntilDay } from './period'
import { ValidationError } from '../../../core/errors/core/validation-error'

describe('period — dias em America/Sao_Paulo', () => {
  it('lançamento às 22h30 em São Paulo (01h30 UTC do dia seguinte) fica no próprio dia', () => {
    expect(toLocalDay(new Date('2026-10-13T01:30:00.000Z'))).toBe('2026-10-12')
  })

  it('meia-noite em São Paulo já é o dia seguinte', () => {
    expect(toLocalDay(new Date('2026-10-13T03:00:00.000Z'))).toBe('2026-10-13')
  })

  it('soma dias atravessando mês e ano', () => {
    expect(addDaysToDay('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysToDay('2026-01-02', -5)).toBe('2025-12-28')
  })

  it('diferença em dias corridos', () => {
    expect(diffDays('2026-10-01', '2026-10-12')).toBe(11)
    expect(diffDays('2026-10-12', '2026-10-12')).toBe(0)
  })

  it('início do dia local é 03h UTC', () => {
    expect(startOfLocalDay('2026-10-12').toISOString()).toBe('2026-10-12T03:00:00.000Z')
  })

  it('início do dia é o inverso de toLocalDay', () => {
    expect(toLocalDay(startOfLocalDay('2026-02-28'))).toBe('2026-02-28')
  })
})

describe('parseGmtOffset', () => {
  it('lê deslocamentos negativos, positivos e o GMT puro', () => {
    expect(parseGmtOffset('GMT-03:00')).toBe(-180)
    expect(parseGmtOffset('GMT+05:30')).toBe(330)
    expect(parseGmtOffset('GMT')).toBe(0)
  })

  it('sem nome de fuso: zero', () => {
    expect(parseGmtOffset(undefined)).toBe(0)
  })
})

describe('meses em America/Sao_Paulo', () => {
  it('22h do dia 31 em São Paulo ainda é aquele mês', () => {
    expect(toLocalMonth(new Date('2026-11-01T01:00:00.000Z'))).toBe('2026-10')
  })

  it('soma e diferença de meses atravessando o ano', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(diffMonths('2025-10', '2026-10')).toBe(12)
  })

  it('início do mês local', () => {
    expect(startOfLocalMonth('2026-10').toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })
})

const NOW = new Date('2026-10-12T15:00:00.000Z')

describe('parseReferenceMonth', () => {
  it('ausente: mês corrente em São Paulo', () => {
    expect(parseReferenceMonth(undefined, NOW)).toBe('2026-10')
    expect(parseReferenceMonth(undefined, new Date('2026-11-01T01:00:00.000Z'))).toBe('2026-10')
  })

  it('aceita o mês corrente e meses passados', () => {
    expect(parseReferenceMonth('2026-10', NOW)).toBe('2026-10')
    expect(parseReferenceMonth('2025-01', NOW)).toBe('2025-01')
  })

  it.each(['2026-13', '2026-1', '2026-00', 'outubro', '2026-10-01'])('formato inválido %s → 400', (v) => {
    expect(() => parseReferenceMonth(v, NOW)).toThrow(ValidationError)
  })

  it('mês futuro → 400', () => {
    expect(() => parseReferenceMonth('2026-11', NOW)).toThrow(ValidationError)
  })
})

describe('comparisonUntilDay (ajuste A1)', () => {
  it('mês atual → dia de hoje em SP; 22h do dia 31 ainda é dia 31', () => {
    expect(comparisonUntilDay('2026-10', new Date('2026-10-13T15:00:00Z'))).toBe(13)
    expect(comparisonUntilDay('2026-10', new Date('2026-11-01T01:00:00Z'))).toBe(31)
  })
  it('mês fechado → null', () => {
    expect(comparisonUntilDay('2026-09', new Date('2026-10-13T15:00:00Z'))).toBeNull()
  })
})
