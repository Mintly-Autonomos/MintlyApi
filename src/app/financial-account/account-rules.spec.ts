import { describe, it, expect } from 'vitest'
import { assertAccountUpdateAllowed, buildAccountChangeHistory } from './account-rules'
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

describe('buildAccountChangeHistory', () => {
  const now = new Date('2026-10-29T12:00:00Z')
  const stored = { name: 'iFood', status: 'active', feePercent: 12, settlementDays: 30 }
  const by = 'user-1'

  it('registra taxa e prazo alterados no formato do protótipo', () => {
    const out = buildAccountChangeHistory(stored, { feePercent: 14.5, settlementDays: 7 }, by, now)
    expect(out).toEqual([
      { at: now, by, action: 'update-fee', detail: '12% → 14,5%' },
      { at: now, by, action: 'update-settlement', detail: '30 dias → 7 dias' },
    ])
  })

  it('registra o nome com antes e depois', () => {
    const out = buildAccountChangeHistory(stored, { name: 'iFood Delivery' }, by, now)
    expect(out).toEqual([{ at: now, by, action: 'update-name', detail: 'iFood → iFood Delivery' }])
  })

  it('registra reativação e inativação pelo status', () => {
    expect(buildAccountChangeHistory({ ...stored, status: 'inactive' }, { status: 'active' }, by, now)).toEqual([{ at: now, by, action: 'reactivate' }])
    expect(buildAccountChangeHistory(stored, { status: 'inactive' }, by, now)).toEqual([{ at: now, by, action: 'inactivate' }])
  })

  it('campo ausente ou com o mesmo valor não gera evento', () => {
    expect(buildAccountChangeHistory(stored, {}, by, now)).toEqual([])
    expect(buildAccountChangeHistory(stored, { name: 'iFood', status: 'active', feePercent: 12, settlementDays: 30 }, by, now)).toEqual([])
  })

  it('taxa e prazo ausentes no armazenado contam como 0', () => {
    const out = buildAccountChangeHistory({ name: 'Conta', status: 'active' }, { feePercent: 3 }, by, now)
    expect(out[0].detail).toBe('0% → 3%')
  })

  it('mais de uma mudança sai na ordem nome, status, taxa, prazo', () => {
    const out = buildAccountChangeHistory({ ...stored, status: 'inactive' }, { settlementDays: 1, feePercent: 1, status: 'active', name: 'X' }, by, now)
    expect(out.map((e) => e.action)).toEqual(['update-name', 'reactivate', 'update-fee', 'update-settlement'])
  })
})
