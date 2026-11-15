import { describe, expect, it } from 'vitest'
import { normalizedDates } from '../../../../scripts/movements/normalize-dates'
import { toBusinessDate, toLocalDay, toLocalMonth } from './period'

describe('toBusinessDate (dia do lançamento gravado como meio-dia em São Paulo)', () => {
  it('"AAAA-MM-DD" vira o meio-dia daquele dia em São Paulo (15:00 UTC)', () => {
    expect(toBusinessDate('2026-05-01').toISOString()).toBe('2026-05-01T15:00:00.000Z')
  })

  it('meia-noite UTC (o mesmo texto depois do new Date) é o mesmo dia, não o anterior', () => {
    const d = toBusinessDate(new Date('2026-05-01T00:00:00.000Z'))
    expect(d.toISOString()).toBe('2026-05-01T15:00:00.000Z')
    expect(toLocalDay(d)).toBe('2026-05-01')
    expect(toLocalMonth(d)).toBe('2026-05') // antes caía em abril
    expect(toBusinessDate('2026-05-01T00:00:00.000Z').toISOString()).toBe('2026-05-01T15:00:00.000Z')
  })

  it('outro instante vale pelo dia local dele (22h de 30/04 em São Paulo é 30/04)', () => {
    expect(toBusinessDate(new Date('2026-05-01T01:00:00.000Z')).toISOString()).toBe('2026-04-30T15:00:00.000Z')
    expect(toBusinessDate('2026-05-01T12:30:00-03:00').toISOString()).toBe('2026-05-01T15:00:00.000Z')
  })

  it('é idempotente: aplicar de novo não muda nada', () => {
    const once = toBusinessDate('2026-12-31')
    expect(toBusinessDate(once).getTime()).toBe(once.getTime())
    expect(toLocalDay(once)).toBe('2026-12-31')
  })

  it('valor inválido volta como está (quem chama recusa)', () => {
    expect(Number.isNaN(toBusinessDate('não é data').getTime())).toBe(true)
  })
})

describe('migração das datas antigas (normalize-dates)', () => {
  const midnight = new Date('2026-10-01T00:00:00.000Z')

  it('corrige date e dueDate à meia-noite UTC, e o settledAt à vista que era igual à date', () => {
    const set = normalizedDates({ date: midnight, dueDate: new Date('2026-10-31T00:00:00.000Z'), settledAt: new Date(midnight) })
    expect(set.date.toISOString()).toBe('2026-10-01T15:00:00.000Z')
    expect(set.dueDate.toISOString()).toBe('2026-10-31T15:00:00.000Z')
    expect(set.settledAt.toISOString()).toBe('2026-10-01T15:00:00.000Z')
  })

  it('não mexe no settledAt com hora (informado pelo dono ou pelo settler)', () => {
    const set = normalizedDates({ date: midnight, settledAt: new Date('2026-10-03T14:22:00.000Z') })
    expect(set.date).toBeDefined()
    expect(set.settledAt).toBeUndefined()
  })

  it('já corrigido (meio-dia) ou sem data: nada a fazer', () => {
    expect(normalizedDates({ date: new Date('2026-10-01T15:00:00.000Z') })).toEqual({})
    expect(normalizedDates({})).toEqual({})
  })
})
