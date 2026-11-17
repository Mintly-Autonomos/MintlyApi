import { describe, expect, it } from 'vitest'
import { resolveSaleFields, SALE_FIELDS_ONLY_IN } from './sale-fields'

describe('resolveSaleFields (S3.4)', () => {
  it('registro: copia o que veio e omite o que não veio', () => {
    expect(resolveSaleFields({ direction: 'in', saleTime: '10:15', salesCount: 7 })).toEqual({ saleTime: '10:15', salesCount: 7 })
    expect(resolveSaleFields({ direction: 'in' })).toEqual({})
  })

  it('edição: ausente mantém, valor troca, null limpa', () => {
    const current = { saleTime: '09:00', salesCount: 10 }
    expect(resolveSaleFields({ direction: 'in', current })).toEqual(current)
    expect(resolveSaleFields({ direction: 'in', current, saleTime: '12:00' })).toEqual({ saleTime: '12:00', salesCount: 10 })
    expect(resolveSaleFields({ direction: 'in', current, saleTime: null, salesCount: null })).toEqual({})
  })

  it('saída: recusa os campos informados e ignora o que estava guardado', () => {
    expect(() => resolveSaleFields({ direction: 'out', saleTime: '10:00' })).toThrow(SALE_FIELDS_ONLY_IN)
    expect(() => resolveSaleFields({ direction: 'out', salesCount: 2 })).toThrow(SALE_FIELDS_ONLY_IN)
    expect(resolveSaleFields({ direction: 'out', saleTime: null, salesCount: null })).toEqual({})
    expect(resolveSaleFields({ direction: 'out', current: { saleTime: '10:00' } })).toEqual({})
  })
})
