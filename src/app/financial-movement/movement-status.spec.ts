import { describe, it, expect, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { MovementStatusSource } from 'mintly-lib'
import { applyStatusTransition } from './movement-status'
import { ConflictError } from '../../core/errors/auth/conflict-error'

const movementDoc = () => ({
  _id: new ObjectId(),
  restaurantId: 'r1',
  direction: 'in',
  status: 'pending',
  grossValue: 100,
  netValue: 90,
  account: { _id: new ObjectId().toString(), name: 'iFood', type: 'platform' },
})

describe('applyStatusTransition', () => {
  it('atualiza o doc com guard de status e move o saldo de predicted para available', async () => {
    const mov = movementDoc()
    const movements = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } as any
    const accounts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } as any

    await applyStatusTransition({
      movements,
      accounts,
      movement: mov,
      newStatus: 'settled',
      actor: 'system',
      statusSource: MovementStatusSource.Auto,
      session: {} as any,
      now: new Date('2026-07-13T00:00:00.000Z'),
    })

    // guard-first: o filtro do updateOne exige o status ANTIGO (idempotência).
    const filter = movements.updateOne.mock.calls[0][0]
    expect(filter).toMatchObject({ _id: mov._id, restaurantId: 'r1', status: 'pending' })

    // duas escritas de saldo: reverte o predicted, aplica o available.
    expect(accounts.updateOne).toHaveBeenCalledTimes(2)
  })

  it('aborta (ConflictError) se outro processo já mudou o status - não mexe no saldo', async () => {
    const movements = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) } as any
    const accounts = { updateOne: vi.fn() } as any

    await expect(applyStatusTransition({
      movements,
      accounts,
      movement: movementDoc(),
      newStatus: 'settled',
      actor: 'system',
      statusSource: MovementStatusSource.Auto,
      session: {} as any,
      now: new Date(),
    })).rejects.toBeInstanceOf(ConflictError)

    expect(accounts.updateOne).not.toHaveBeenCalled()
  })
})
