import { describe, it, expect } from 'vitest'
import { assertAccountUpdateAllowed } from './account-rules'
import { ConflictError } from '../../core/errors/auth/conflict-error'

describe('assertAccountUpdateAllowed (P5)', () => {
  it('rejeita troca de tipo (o tipo da conta é imutável)', () => {
    expect(() => assertAccountUpdateAllowed('bank', { type: 'platform' }))
      .toThrow(ConflictError)
  })

  it('rejeita feePercent em conta que não é platform', () => {
    expect(() => assertAccountUpdateAllowed('bank', { feePercent: 5 }))
      .toThrow(ConflictError)
  })

  it('rejeita settlementDays em conta que não é platform', () => {
    expect(() => assertAccountUpdateAllowed('cash', { settlementDays: 30 }))
      .toThrow(ConflictError)
  })

  it('aceita feePercent em conta platform', () => {
    expect(() => assertAccountUpdateAllowed('platform', { feePercent: 15 })).not.toThrow()
  })

  it('aceita edição sem campos de taxa em qualquer conta', () => {
    expect(() => assertAccountUpdateAllowed('bank', {})).not.toThrow()
  })
})
