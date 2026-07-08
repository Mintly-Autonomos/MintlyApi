import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { ChangeMovementStatusUseCase } from './change-movement-status.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'

const mockGetDatabase = vi.hoisted(() => vi.fn())
const mockStartSession = vi.hoisted(() => vi.fn())

vi.mock('../../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: () => ({
      getClient: () => ({ startSession: mockStartSession }),
      getDatabase: mockGetDatabase,
    }),
  },
}))

const MOV_ID = new ObjectId().toHexString()
const ACC_ID = new ObjectId().toHexString()
const CTX: any = { env: 'test', restaurantId: 'r1', userId: 'u1' }

function makeMov (over: Record<string, any> = {}) {
  return {
    _id: new ObjectId(MOV_ID),
    restaurantId: 'r1',
    direction: 'in',
    status: 'pending',
    grossValue: 100,
    netValue: 100,
    account: { _id: ACC_ID, name: 'Caixa', type: 'cash' },
    ...over,
  }
}

function wire (opts: { mov?: any } = {}) {
  const mov = 'mov' in opts ? opts.mov : makeMov()
  const movements = { findOne: vi.fn().mockResolvedValue(mov), updateOne: vi.fn().mockResolvedValue({}) }
  const accounts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) }
  const map: Record<string, any> = { financial_movements: movements, financial_accounts: accounts }
  mockGetDatabase.mockReturnValue({ collection: (n: string) => map[n] })
  return { movements, accounts }
}

describe('ChangeMovementStatusUseCase', () => {
  let useCase: ChangeMovementStatusUseCase
  let session: any

  beforeEach(() => {
    vi.clearAllMocks()
    session = { withTransaction: async (cb: any) => { await cb() }, endSession: vi.fn().mockResolvedValue(undefined) }
    mockStartSession.mockReturnValue(session)
    useCase = new ChangeMovementStatusUseCase()
  })

  it('status inválido lança ConflictError sem abrir transação', async () => {
    await expect(useCase.execute(MOV_ID, 'xpto', CTX)).rejects.toBeInstanceOf(ConflictError)
    expect(mockStartSession).not.toHaveBeenCalled()
  })

  it('id inválido lança NotFoundError', async () => {
    await expect(useCase.execute('invalido', 'settled', CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('movimentação inexistente lança NotFoundError', async () => {
    wire({ mov: null })
    await expect(useCase.execute(MOV_ID, 'settled', CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(session.endSession).toHaveBeenCalled()
  })

  it('mesmo status é no-op: não atualiza saldo nem movimentação', async () => {
    const { movements, accounts } = wire({ mov: makeMov({ status: 'settled' }) })
    const updated = await useCase.execute(MOV_ID, 'settled', CTX)
    expect(updated.status).toBe('settled')
    expect(movements.updateOne).not.toHaveBeenCalled()
    expect(accounts.updateOne).not.toHaveBeenCalled()
  })

  it('transição pending→settled reverte previsto e aplica disponível (saldo x2)', async () => {
    const { movements, accounts } = wire()
    const updated = await useCase.execute(MOV_ID, 'settled', CTX)
    expect(updated.status).toBe('settled')
    expect(accounts.updateOne).toHaveBeenCalledTimes(2)
    const [, update] = movements.updateOne.mock.calls[0]
    expect(update.$set.status).toBe('settled')
    expect(update.$push.history.action).toBe('status:pending->settled')
    expect(update.$push.history.by).toBe('u1')
  })

  it('sem userId no contexto registra history por "system"', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, 'settled', { env: 'test', restaurantId: 'r1' } as any)
    const [, update] = movements.updateOne.mock.calls[0]
    expect(update.$push.history.by).toBe('system')
    expect(update.$set['audit.updatedBy']).toBeUndefined()
  })

  it('valores nulos na movimentação são tratados como 0 (branch ?? 0)', async () => {
    const { movements, accounts } = wire({ mov: makeMov({ status: 'cancelled', grossValue: undefined, netValue: undefined }) })
    const updated = await useCase.execute(MOV_ID, 'settled', CTX)
    expect(updated.status).toBe('settled')
    // cancelled (sem impacto) -> settled (impacto com delta 0): só a aplicação nova toca o saldo.
    expect(accounts.updateOne).toHaveBeenCalledTimes(1)
    expect(movements.updateOne).toHaveBeenCalledTimes(1)
  })
})
