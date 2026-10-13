import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../core/errors/core/validation-error'
import { parseReferenceMonth } from './reference-month'

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
