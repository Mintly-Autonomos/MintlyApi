import { describe, it, expect } from 'vitest'
import { assertAccountUpdateAllowed, assertPlatformSettlement, buildAccountChangeHistory, syncLegacySettlementDays } from './account-rules'
import { ValidationError } from '../../core/errors/core/validation-error'
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

describe('regra de repasse da conta', () => {
  const quarta = { kind: 'weekly', weekday: 3 } as any

  it('conta plataforma sem regra nem prazo é recusada na criação', () => {
    expect(() => assertPlatformSettlement({ type: 'platform' })).toThrow(ValidationError)
  })

  it('plataforma com regra, ou só com o prazo antigo, passa', () => {
    expect(() => assertPlatformSettlement({ type: 'platform', settlementRule: quarta })).not.toThrow()
    expect(() => assertPlatformSettlement({ type: 'platform', settlementDays: 0 })).not.toThrow()
  })

  it('quinzenal com o mesmo dia duas vezes é recusado', () => {
    const igual = { kind: 'biweekly', firstDay: 10, secondDay: 10 } as any
    expect(() => assertPlatformSettlement({ type: 'platform', settlementRule: igual })).toThrow(ValidationError)
    expect(() => assertAccountUpdateAllowed('platform', { settlementRule: igual })).toThrow(ValidationError)
  })

  it('outros tipos de conta não exigem nada, mas não aceitam regra no PATCH', () => {
    expect(() => assertPlatformSettlement({ type: 'bank' })).not.toThrow()
    expect(() => assertAccountUpdateAllowed('bank', { settlementRule: quarta })).toThrow(ConflictError)
    expect(() => assertAccountUpdateAllowed('platform', { settlementRule: quarta })).not.toThrow()
  })

  it('"N dias" mantém o settlementDays antigo igual; as demais regras não mexem nele', () => {
    expect(syncLegacySettlementDays({ settlementRule: { kind: 'afterDays', days: 7 } as any }).settlementDays).toBe(7)
    expect(syncLegacySettlementDays({ settlementRule: quarta, settlementDays: 3 }).settlementDays).toBe(3)
  })

  it('o histórico conta a troca de regra em palavras', () => {
    const now = new Date('2026-11-02T10:00:00.000Z')
    const [e] = buildAccountChangeHistory({ settlementDays: 7 }, { settlementRule: quarta }, 'u1', now)
    expect(e).toMatchObject({ action: 'update-settlement', detail: '7 dias após a venda → Toda quarta-feira' })
  })

  it('reenviar a mesma regra não suja o histórico', () => {
    expect(buildAccountChangeHistory({ settlementRule: quarta }, { settlementRule: quarta }, 'u1')).toEqual([])
  })
})
