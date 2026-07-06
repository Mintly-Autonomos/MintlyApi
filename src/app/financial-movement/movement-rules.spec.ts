import { describe, it, expect } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { defaultStatus, computeSnapshot, balanceImpact, addDays } from './movement-rules'

const cash = { type: 'cash' }
const platform = { type: 'platform', feePercent: 12, settlementDays: 30 }

describe('movement-rules', () => {
  describe('defaultStatus', () => {
    it('conta com prazo de recebimento (>0) → pending', () => {
      expect(defaultStatus(platform)).toBe(MovementStatus.Pending)
    })

    it('conta sem prazo → settled', () => {
      expect(defaultStatus(cash)).toBe(MovementStatus.Settled)
    })

    it('prazo = 0 → settled (recebimento imediato)', () => {
      expect(defaultStatus({ type: 'platform', feePercent: 5, settlementDays: 0 })).toBe(MovementStatus.Settled)
    })
  })

  describe('addDays', () => {
    it('soma dias corridos', () => {
      expect(addDays(new Date('2026-06-16T00:00:00.000Z'), 30).toISOString())
        .toBe('2026-07-16T00:00:00.000Z')
    })
  })

  describe('computeSnapshot', () => {
    const date = new Date('2026-06-16T00:00:00.000Z')

    it('entrada em conta platform: fee/net + snapshot + data prevista', () => {
      expect(computeSnapshot({ direction: MovementDirection.In, grossValue: 100, date, account: platform }))
        .toEqual({
          feeValue: 12,
          netValue: 88,
          feePercentApplied: 12,
          settlementDaysApplied: 30,
          predictedReceiptDate: new Date('2026-07-16T00:00:00.000Z'),
        })
    })

    it('entrada em conta não-platform: sem fee, net = bruto, sem snapshot', () => {
      expect(computeSnapshot({ direction: MovementDirection.In, grossValue: 100, date, account: cash }))
        .toEqual({ feeValue: 0, netValue: 100 })
    })

    it('saída nunca tem fee/net nem data prevista (mesmo em conta platform)', () => {
      expect(computeSnapshot({ direction: MovementDirection.Out, grossValue: 100, date, account: platform }))
        .toEqual({ feeValue: 0, netValue: 100 })
    })

    it('entrada em conta platform SEM settlementDays: aplica fee/net mas sem prazo/data prevista', () => {
      const platformSemPrazo = { type: 'platform', feePercent: 10 }
      expect(computeSnapshot({ direction: MovementDirection.In, grossValue: 100, date, account: platformSemPrazo }))
        .toEqual({
          feeValue: 10,
          netValue: 90,
          feePercentApplied: 10,
        })
    })
  })

  describe('balanceImpact', () => {
    it('entrada settled → available += netValue', () => {
      expect(balanceImpact({ direction: MovementDirection.In, status: MovementStatus.Settled, grossValue: 100, netValue: 88 }))
        .toEqual({ bucket: 'available', delta: 88 })
    })

    it('entrada pending → predicted += netValue', () => {
      expect(balanceImpact({ direction: MovementDirection.In, status: MovementStatus.Pending, grossValue: 100, netValue: 88 }))
        .toEqual({ bucket: 'predicted', delta: 88 })
    })

    it('saída settled → available −= grossValue', () => {
      expect(balanceImpact({ direction: MovementDirection.Out, status: MovementStatus.Settled, grossValue: 50, netValue: 50 }))
        .toEqual({ bucket: 'available', delta: -50 })
    })

    it('saída pending → predicted −= grossValue', () => {
      expect(balanceImpact({ direction: MovementDirection.Out, status: MovementStatus.Pending, grossValue: 50, netValue: 50 }))
        .toEqual({ bucket: 'predicted', delta: -50 })
    })

    it('cancelled → sem impacto', () => {
      expect(balanceImpact({ direction: MovementDirection.In, status: MovementStatus.Cancelled, grossValue: 100, netValue: 88 }))
        .toEqual({ bucket: null, delta: 0 })
    })
  })
})
