import { describe, it, expect } from 'vitest'
import { mergeItemRequests } from './movement-items'
import { ValidationError } from '../../core/errors/core/validation-error'

describe('mergeItemRequests', () => {
  it('o mesmo prato repetido vira uma linha só, com as quantidades somadas', () => {
    expect(mergeItemRequests([
      { menuItemId: 'a', qty: 1 },
      { menuItemId: 'b', qty: 2 },
      { menuItemId: 'a', qty: 3 },
    ])).toEqual([
      { menuItemId: 'a', qty: 4 },
      { menuItemId: 'b', qty: 2 },
    ])
  })

  it('mantém a ordem da primeira aparição', () => {
    expect(mergeItemRequests([
      { menuItemId: 'z', qty: 1 },
      { menuItemId: 'a', qty: 1 },
    ]).map((i) => i.menuItemId)).toEqual(['z', 'a'])
  })

  it('passar de 99 unidades do mesmo prato é recusado', () => {
    expect(() => mergeItemRequests([
      { menuItemId: 'a', qty: 60 },
      { menuItemId: 'a', qty: 60 },
    ])).toThrow(ValidationError)
  })

  it('lista vazia continua vazia', () => {
    expect(mergeItemRequests([])).toEqual([])
  })
})
