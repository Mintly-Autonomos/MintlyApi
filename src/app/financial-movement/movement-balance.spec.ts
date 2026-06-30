import { describe, it, expect, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { applyBalanceImpact } from './movement-balance'

describe('applyBalanceImpact', () => {
  const makeAccounts = () => ({ updateOne: vi.fn().mockResolvedValue({}) })
  const id = new ObjectId()
  const now = new Date()
  const session = {} as any

  it('aplica no availableBalance quando bucket=available (sign +1)', async () => {
    const accounts = makeAccounts()
    await applyBalanceImpact(accounts as any, id, { bucket: 'available', delta: 50 }, 1, session, now)

    const [filter, update, opts] = accounts.updateOne.mock.calls[0]
    expect(filter._id).toBe(id)
    expect(update.$inc.availableBalance.toString()).toBe('50.00')
    expect(opts).toEqual({ session })
  })

  it('aplica no predictedBalance e respeita sinal negativo', async () => {
    const accounts = makeAccounts()
    await applyBalanceImpact(accounts as any, id, { bucket: 'predicted', delta: -30 }, 1, session, now)

    expect(accounts.updateOne.mock.calls[0][1].$inc.predictedBalance.toString()).toBe('-30.00')
  })

  it('reverte o efeito com sign -1', async () => {
    const accounts = makeAccounts()
    await applyBalanceImpact(accounts as any, id, { bucket: 'available', delta: 50 }, -1, session, now)

    expect(accounts.updateOne.mock.calls[0][1].$inc.availableBalance.toString()).toBe('-50.00')
  })

  it('não toca o banco quando bucket é null (cancelled)', async () => {
    const accounts = makeAccounts()
    await applyBalanceImpact(accounts as any, id, { bucket: null, delta: 0 }, 1, session, now)

    expect(accounts.updateOne).not.toHaveBeenCalled()
  })
})
