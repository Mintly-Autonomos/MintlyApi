import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { RecomputeBalancesUseCase } from './recompute-balances.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'

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

const ACC_ID = new ObjectId().toHexString()
const CTX: any = { env: 'test', restaurantId: 'r1', userId: 'u1' }

function wire (opts: { account?: any, movs?: any[] } = {}) {
  const account = 'account' in opts ? opts.account : { _id: new ObjectId(ACC_ID), restaurantId: 'r1' }
  const movs = opts.movs ?? []
  const accounts = { findOne: vi.fn().mockResolvedValue(account), updateOne: vi.fn().mockResolvedValue({}) }
  const movements = { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(movs) }) }
  const map: Record<string, any> = { financial_accounts: accounts, financial_movements: movements }
  mockGetDatabase.mockReturnValue({ collection: (n: string) => map[n] })
  return { accounts, movements }
}

describe('RecomputeBalancesUseCase', () => {
  let useCase: RecomputeBalancesUseCase
  let session: any

  beforeEach(() => {
    vi.clearAllMocks()
    session = { withTransaction: async (cb: any) => { await cb() }, endSession: vi.fn().mockResolvedValue(undefined) }
    mockStartSession.mockReturnValue(session)
    useCase = new RecomputeBalancesUseCase()
  })

  it('accountId inválido lança NotFoundError sem abrir transação', async () => {
    await expect(useCase.execute('invalido', CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(mockStartSession).not.toHaveBeenCalled()
  })

  it('conta inexistente lança NotFoundError', async () => {
    wire({ account: null })
    await expect(useCase.execute(ACC_ID, CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(session.endSession).toHaveBeenCalled()
  })

  it('reconcilia somando disponível/previsto, ignora cancelada e trata valores nulos', async () => {
    const { accounts } = wire({
      movs: [
        { direction: 'in', status: 'settled', grossValue: 100, netValue: 100 },
        { direction: 'in', status: 'pending', grossValue: 50, netValue: 45 },
        { direction: 'in', status: 'cancelled', grossValue: 30, netValue: 30 },
        { direction: 'out', status: 'settled', grossValue: 20, netValue: 20 },
        { direction: 'in', status: 'settled' }, // grossValue/netValue nulos -> branch (v ?? 0)
      ],
    })
    const result = await useCase.execute(ACC_ID, CTX)
    expect(result).toEqual({ availableBalance: 80, predictedBalance: 45 })
    expect(accounts.updateOne).toHaveBeenCalledTimes(1)
    const [, update] = accounts.updateOne.mock.calls[0]
    expect(update.$set).toHaveProperty('availableBalance')
    expect(update.$set).toHaveProperty('predictedBalance')
  })

  it('conta sem movimentações zera os saldos', async () => {
    wire({ movs: [] })
    const result = await useCase.execute(ACC_ID, CTX)
    expect(result).toEqual({ availableBalance: 0, predictedBalance: 0 })
  })
})
