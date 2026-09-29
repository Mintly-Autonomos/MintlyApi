import { describe, it, expect } from 'vitest'
import { MovementDirection, MovementStatus } from 'mintly-lib'
import { defaultStatus, computeSnapshot, balanceImpact, addDays } from './movement-rules'

const cash = { type: 'cash' }
const platform = { type: 'platform', feePercent: 12, settlementDays: 30 }

describe('movement-rules', () => {
  describe('defaultStatus', () => {
    it('com vencimento futuro → pending', () => {
      expect(defaultStatus({ dueDate: new Date('2099-01-01T00:00:00.000Z') })).toBe(MovementStatus.Pending)
    })

    it('com vencimento JÁ PASSADO → pending (vencido, não pago)', () => {
      // Vencer não é pagar. Só o dono sabe se pagou, e ele diz isso pelo
      // PATCH /:id/status — não pelo calendário. Se a data mandasse, o bloco
      // "Vencidos" do Fluxo de Caixa nunca teria conteúdo.
      expect(defaultStatus({ dueDate: new Date('2020-01-01T00:00:00.000Z') })).toBe(MovementStatus.Pending)
    })

    it('sem vencimento → settled (à vista)', () => {
      expect(defaultStatus({})).toBe(MovementStatus.Settled)
    })

    it('vencimento nulo → settled', () => {
      expect(defaultStatus({ dueDate: null })).toBe(MovementStatus.Settled)
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
          dueDate: new Date('2026-07-16T00:00:00.000Z'),
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

    it('entrada em conta platform SEM settlementDays: aplica fee/net mas sem prazo/vencimento', () => {
      const platformSemPrazo = { type: 'platform', feePercent: 10 }
      expect(computeSnapshot({ direction: MovementDirection.In, grossValue: 100, date, account: platformSemPrazo }))
        .toEqual({
          feeValue: 10,
          netValue: 90,
          feePercentApplied: 10,
        })
    })

    it('prazo ZERO na conta viva: registra o prazo aplicado mas NÃO gera vencimento', () => {
      // Prazo zero é "cai na hora". Sem esta guarda o movimento nasceria
      // `pending` com vencimento igual à data do lançamento — o oposto do que a
      // conta de prazo zero faz hoje.
      const semEspera = { type: 'platform', feePercent: 5, settlementDays: 0 }

      const snap = computeSnapshot({ direction: MovementDirection.In, grossValue: 100, date, account: semEspera })

      expect(snap.settlementDaysApplied).toBe(0)
      expect(snap.dueDate).toBeUndefined()
    })
  })

  describe('computeSnapshot com taxa congelada (P3)', () => {
    const platformAccount = { type: 'platform', feePercent: 20, settlementDays: 30 }

    it('usa a taxa congelada em vez da taxa viva da conta', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: platformAccount,
        fee: { percent: 10, settlementDays: 5 },
      })

      expect(snap.feeValue).toBe(10)
      expect(snap.netValue).toBe(90)
      expect(snap.feePercentApplied).toBe(10)
      expect(snap.settlementDaysApplied).toBe(5)
      expect(snap.dueDate).toEqual(new Date('2026-01-15T00:00:00.000Z'))
    })

    it('sem fee congelado, deriva da conta viva (comportamento do registro)', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: platformAccount,
      })

      expect(snap.feeValue).toBe(20)
      expect(snap.netValue).toBe(80)
      expect(snap.feePercentApplied).toBe(20)
      expect(snap.settlementDaysApplied).toBe(30)
    })

    it('taxa congelada não se aplica a saída', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.Out,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: platformAccount,
        fee: { percent: 10, settlementDays: 5 },
      })

      expect(snap.feeValue).toBe(0)
      expect(snap.netValue).toBe(100)
      expect(snap.feePercentApplied).toBeUndefined()
    })

    it('taxa congelada não se aplica a conta não-platform', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: { type: 'bank' },
        fee: { percent: 10, settlementDays: 5 },
      })

      expect(snap.feeValue).toBe(0)
      expect(snap.netValue).toBe(100)
    })

    it('fee: { percent: 0 } → taxa zero é respeitada, não cai na taxa da conta', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: platformAccount,
        fee: { percent: 0 },
      })

      expect(snap.feeValue).toBe(0)
      expect(snap.netValue).toBe(100)
      expect(snap.feePercentApplied).toBe(0)
    })

    it('fee: { percent: 10 } sem settlementDays, conta com settlementDays: não deriva prazo da conta', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: platformAccount,
        fee: { percent: 10 },
      })

      expect(snap.feePercentApplied).toBe(10)
      expect(snap.settlementDaysApplied).toBeUndefined()
      expect(snap.dueDate).toBeUndefined()
    })

    it('fee: { settlementDays: 0 } → prazo zero é respeitado e NÃO gera vencimento', () => {
      const date = new Date('2026-01-10T00:00:00.000Z')
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date,
        account: platformAccount,
        fee: { settlementDays: 0 },
      })

      expect(snap.settlementDaysApplied).toBe(0)
      expect(snap.dueDate).toBeUndefined()
    })

    it('fee: {} (objeto vazio) → sem taxa e sem prazo; nada da conta viva vaza', () => {
      const snap = computeSnapshot({
        direction: MovementDirection.In,
        grossValue: 100,
        date: new Date('2026-01-10T00:00:00.000Z'),
        account: platformAccount,
        fee: {},
      })

      expect(snap.feeValue).toBe(0)
      expect(snap.netValue).toBe(100)
      expect(snap.feePercentApplied).toBeUndefined()
      expect(snap.settlementDaysApplied).toBeUndefined()
      expect(snap.dueDate).toBeUndefined()
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
