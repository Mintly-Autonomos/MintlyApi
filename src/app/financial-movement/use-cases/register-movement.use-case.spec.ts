import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { RegisterMovementUseCase } from './register-movement.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'

const mockGetDatabase = vi.hoisted(() => vi.fn())
const mockStartSession = vi.hoisted(() => vi.fn())
const mockSchemaParse = vi.hoisted(() => vi.fn())

vi.mock('../../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: () => ({
      getClient: () => ({ startSession: mockStartSession }),
      getDatabase: mockGetDatabase,
    }),
  },
}))

vi.mock('mintly-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mintly-lib')>()
  return { ...actual, financialMovementSchema: { parse: mockSchemaParse } }
})

const ACC_ID = new ObjectId().toHexString()
const CAT_ID = new ObjectId().toHexString()
const INSERTED_ID = new ObjectId()
const CTX: any = { env: 'test', restaurantId: 'r1', userId: 'u1' }

function makeAccount (over: Record<string, any> = {}) {
  return { _id: new ObjectId(ACC_ID), restaurantId: 'r1', name: 'Caixa', type: 'cash', status: 'active', ...over }
}

function makeInput (over: Record<string, any> = {}) {
  return {
    direction: 'in',
    title: 'Venda',
    grossValue: 100,
    date: '2026-06-16T00:00:00.000Z',
    accountId: ACC_ID,
    categoryId: CAT_ID,
    paymentMethod: 'cash',
    ...over,
  } as any
}

function wire (opts: { account?: any, category?: any } = {}) {
  const account = 'account' in opts ? opts.account : makeAccount()
  const category = 'category' in opts ? opts.category : { _id: new ObjectId(CAT_ID), name: 'Vendas', type: 'revenue' }
  const accounts = { findOne: vi.fn().mockResolvedValue(account), updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) }
  const categories = { findOne: vi.fn().mockResolvedValue(category) }
  const movements = { insertOne: vi.fn().mockResolvedValue({ insertedId: INSERTED_ID }) }
  const map: Record<string, any> = { financial_accounts: accounts, financial_categories: categories, financial_movements: movements }
  mockGetDatabase.mockReturnValue({ collection: (n: string) => map[n] })
  return { accounts, categories, movements }
}

const storedDoc = (movements: any) => movements.insertOne.mock.calls[0][0]

describe('RegisterMovementUseCase', () => {
  let useCase: RegisterMovementUseCase
  let repo: any
  let session: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockSchemaParse.mockReset()
    session = { withTransaction: async (cb: any) => { await cb() }, endSession: vi.fn().mockResolvedValue(undefined) }
    mockStartSession.mockReturnValue(session)
    repo = { findDuplicate: vi.fn().mockResolvedValue(null) }
    useCase = new RegisterMovementUseCase(repo)
  })

  it('accountId inválido lança NotFoundError', async () => {
    wire()
    await expect(useCase.execute(makeInput({ accountId: 'invalido' }), CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('conta inexistente lança NotFoundError', async () => {
    wire({ account: null })
    await expect(useCase.execute(makeInput(), CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('conta inativa lança ConflictError', async () => {
    wire({ account: makeAccount({ status: 'inactive' }) })
    await expect(useCase.execute(makeInput(), CTX)).rejects.toBeInstanceOf(ConflictError)
  })

  it('categoryId inválido lança NotFoundError', async () => {
    wire()
    await expect(useCase.execute(makeInput({ categoryId: 'invalido' }), CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('categoria inexistente lança NotFoundError', async () => {
    wire({ category: null })
    await expect(useCase.execute(makeInput(), CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('registra em conta cash (settled) e credita o saldo disponível', async () => {
    const { accounts, movements } = wire()
    const created = await useCase.execute(makeInput(), CTX)
    expect(created._id).toEqual(INSERTED_ID)
    expect(created.status).toBe('settled')
    expect(storedDoc(movements).history[0].by).toBe('u1')
    expect(accounts.updateOne).toHaveBeenCalledTimes(1)
    const [, update] = accounts.updateOne.mock.calls[0]
    expect(update.$inc).toHaveProperty('availableBalance')
  })

  it('sem userId no contexto registra history por "system"', async () => {
    const { movements } = wire()
    await useCase.execute(makeInput(), { env: 'test', restaurantId: 'r1' } as any)
    expect(storedDoc(movements).history[0].by).toBe('system')
  })

  it('status cancelled não gera impacto no saldo (branch impact.bucket falso)', async () => {
    const { accounts, movements } = wire()
    await useCase.execute(makeInput({ status: 'cancelled' }), CTX)
    expect(movements.insertOne).toHaveBeenCalledTimes(1)
    expect(accounts.updateOne).not.toHaveBeenCalled()
  })

  it('conta platform: status pending default credita o saldo previsto e grava snapshot', async () => {
    const { accounts, movements } = wire({ account: makeAccount({ type: 'platform', feePercent: 10, settlementDays: 14 }) })
    const created = await useCase.execute(makeInput(), CTX)
    expect(created.status).toBe('pending')
    expect(created.netValue).toBe(90)
    const doc = storedDoc(movements)
    expect(Number(doc.feePercentApplied)).toBe(10)
    expect(doc.settlementDaysApplied).toBe(14)
    expect(doc.predictedReceiptDate).toBeInstanceOf(Date)
    const [, update] = accounts.updateOne.mock.calls[0]
    expect(update.$inc).toHaveProperty('predictedBalance')
  })

  it('bloqueia duplicidade quando findDuplicate retorna algo', async () => {
    wire()
    repo.findDuplicate.mockResolvedValue({ _id: 'dup' })
    await expect(useCase.execute(makeInput(), CTX)).rejects.toBeInstanceOf(ConflictError)
  })

  it('confirmDuplicate=true pula a checagem de duplicidade', async () => {
    wire()
    await useCase.execute(makeInput({ confirmDuplicate: true }), CTX)
    expect(repo.findDuplicate).not.toHaveBeenCalled()
  })

  it('campos opcionais counterparty/fiscalNote/description são persistidos', async () => {
    const { movements } = wire()
    await useCase.execute(makeInput({ counterparty: { name: 'Cliente', kind: 'client' }, fiscalNote: 'NF-1', description: 'obs', origin: 'manual' }), CTX)
    const doc = storedDoc(movements)
    expect(doc.counterparty).toEqual({ name: 'Cliente', kind: 'client' })
    expect(doc.fiscalNote).toBe('NF-1')
    expect(doc.description).toBe('obs')
    expect(doc.origin).toBe('manual')
  })

  it('erro de validação do schema propaga e encerra a sessão', async () => {
    wire()
    mockSchemaParse.mockImplementation(() => { throw new Error('schema invalido') })
    await expect(useCase.execute(makeInput(), CTX)).rejects.toThrow('schema invalido')
    expect(session.endSession).toHaveBeenCalled()
  })

  it('grava statusSource auto no registro (P1)', async () => {
    wire()
    const created = await useCase.execute(makeInput(), CTX)
    expect(created.statusSource).toBe('auto')
  })
})
