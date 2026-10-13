import { describe, expect, it } from 'vitest'
import { RecordStatus } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ValidationError } from '../../core/errors/core/validation-error'
import { assertUniqueSubcategoryName, findSubcategory, normalizeSubcategoryName } from './subcategory-rules'

const subs = [
  { _id: 's1', name: 'Frango', status: RecordStatus.Active },
  { _id: 's2', name: 'Óleo', status: RecordStatus.Inactive },
]

describe('normalizeSubcategoryName', () => {
  it('apara espaços', () => expect(normalizeSubcategoryName('  Frango  ')).toBe('Frango'))
  it.each(['', '   ', undefined, 42])('inválido %j → 400', (v) => expect(() => normalizeSubcategoryName(v)).toThrow(ValidationError))
  it('mais de 60 → 400', () => expect(() => normalizeSubcategoryName('x'.repeat(61))).toThrow(ValidationError))
  it('60 com espaços em volta é aceito', () => expect(normalizeSubcategoryName(` ${'x'.repeat(60)} `)).toHaveLength(60))
})

describe('assertUniqueSubcategoryName', () => {
  it('repetido sem diferenciar maiúsculas, inclusive inativa → 409', () => {
    expect(() => assertUniqueSubcategoryName(subs, 'frango')).toThrow(ConflictError)
    expect(() => assertUniqueSubcategoryName(subs, 'ÓLEO')).toThrow(ConflictError)
  })

  it('renomear para o próprio nome não conflita; lista ausente aceita', () => {
    expect(() => assertUniqueSubcategoryName(subs, 'FRANGO', 's1')).not.toThrow()
    expect(() => assertUniqueSubcategoryName(undefined, 'Frango')).not.toThrow()
  })
})

describe('findSubcategory', () => {
  it('por _id; lista ausente → undefined', () => {
    expect(findSubcategory({ subcategories: subs }, 's2')?.name).toBe('Óleo')
    expect(findSubcategory({}, 's1')).toBeUndefined()
  })
})
