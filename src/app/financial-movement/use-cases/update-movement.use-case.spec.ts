import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { UpdateMovementUseCase } from './update-movement.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'

// --- Mocks de infraestrutura (DB) e validação Sapphire ---------------------
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

// Mantém enums reais da lib; só substitui a validação do schema (não é branch).
vi.mock('mintly-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mintly-lib')>()
  return { ...actual, financialMovementSchema: { parse: mockSchemaParse } }
})

const MOV_ID = new ObjectId().toHexString()
const ACC_ID = new ObjectId().toHexString()
const ACC2_ID = new ObjectId().toHexString()
const CAT_ID = new ObjectId().toHexString()
const CAT2_ID = new ObjectId().toHexString()
const CTX: any = { env: 'test', restaurantId: 'r1', userId: 'u1' }

function makeMov (over: Record<string, any> = {}) {
  return {
    _id: new ObjectId(MOV_ID),
    restaurantId: 'r1',
    direction: 'in',
    title: 'Venda',
    status: 'settled',
    date: new Date('2026-06-16T00:00:00.000Z'),
    grossValue: 100,
    feeValue: 0,
    netValue: 100,
    account: { _id: ACC_ID, name: 'Caixa', type: 'cash' },
    category: { _id: CAT_ID, name: 'Vendas', type: 'revenue' },
    paymentMethod: 'cash',
    origin: 'manual',
    history: [{ at: new Date('2026-06-16'), by: 'u1', action: 'register' }],
    audit: { createdAt: new Date('2026-06-10'), createdBy: 'u1', updatedAt: new Date('2026-06-16'), updatedBy: 'u1' },
    ...over,
  }
}

function makeAccount (over: Record<string, any> = {}) {
  return { _id: new ObjectId(ACC_ID), restaurantId: 'r1', name: 'Caixa', type: 'cash', status: 'active', ...over }
}

function wire (opts: { mov?: any, account?: any, category?: any } = {}) {
  const mov = 'mov' in opts ? opts.mov : makeMov()
  const account = 'account' in opts ? opts.account : makeAccount()
  const category = 'category' in opts ? opts.category : { _id: new ObjectId(CAT2_ID), name: 'Nova', type: 'revenue' }
  const movements = { findOne: vi.fn().mockResolvedValue(mov), replaceOne: vi.fn().mockResolvedValue({}) }
  const accounts = { findOne: vi.fn().mockResolvedValue(account), updateOne: vi.fn().mockResolvedValue({}) }
  const categories = { findOne: vi.fn().mockResolvedValue(category) }
  const map: Record<string, any> = { financial_movements: movements, financial_accounts: accounts, financial_categories: categories }
  mockGetDatabase.mockReturnValue({ collection: (n: string) => map[n] })
  return { movements, accounts, categories }
}

/** Extrai o storageDoc passado ao replaceOne (2º argumento). */
const storedDoc = (movements: any) => movements.replaceOne.mock.calls[0][1]

describe('UpdateMovementUseCase', () => {
  let useCase: UpdateMovementUseCase
  let session: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockSchemaParse.mockReset()
    session = { withTransaction: async (cb: any) => { await cb() }, endSession: vi.fn().mockResolvedValue(undefined) }
    mockStartSession.mockReturnValue(session)
    useCase = new UpdateMovementUseCase()
  })

  it('id de movimentação inválido lança NotFoundError sem abrir transação', async () => {
    await expect(useCase.execute('xpto', {}, CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(mockStartSession).not.toHaveBeenCalled()
  })

  it('movimentação inexistente lança NotFoundError', async () => {
    wire({ mov: null })
    await expect(useCase.execute(MOV_ID, {}, CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(session.endSession).toHaveBeenCalled()
  })

  it('accountId novo inválido lança NotFoundError (FinancialAccount)', async () => {
    wire()
    await expect(useCase.execute(MOV_ID, { accountId: 'invalido' }, CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('conta nova inexistente lança NotFoundError', async () => {
    wire({ account: null })
    await expect(useCase.execute(MOV_ID, { accountId: ACC2_ID }, CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('mover p/ conta inativa (id diferente) lança ConflictError', async () => {
    wire({ account: makeAccount({ _id: new ObjectId(ACC2_ID), status: 'inactive' }) })
    await expect(useCase.execute(MOV_ID, { accountId: ACC2_ID }, CTX)).rejects.toBeInstanceOf(ConflictError)
  })

  it('categoryId inválido lança NotFoundError (FinancialCategory)', async () => {
    wire()
    await expect(useCase.execute(MOV_ID, { categoryId: 'invalido' }, CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('categoria inexistente lança NotFoundError (branch cat nulo)', async () => {
    wire({ category: null })
    await expect(useCase.execute(MOV_ID, { categoryId: CAT2_ID }, CTX)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('troca de categoria atualiza o snapshot da categoria', async () => {
    wire()
    const updated = await useCase.execute(MOV_ID, { categoryId: CAT2_ID }, CTX)
    expect(updated.category).toEqual({ _id: CAT2_ID, name: 'Nova', type: 'revenue' })
  })

  it('sem categoryId preserva a categoria original', async () => {
    wire()
    const updated = await useCase.execute(MOV_ID, {}, CTX)
    expect(updated.category._id).toBe(CAT_ID)
  })

  it('sem date preserva a data da movimentação', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, {}, CTX)
    expect(storedDoc(movements).date).toEqual(new Date('2026-06-16T00:00:00.000Z'))
  })

  it('com date nova aplica a data informada', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, { date: '2026-07-01T00:00:00.000Z' }, CTX)
    expect(storedDoc(movements).date).toEqual(new Date('2026-07-01T00:00:00.000Z'))
  })

  it('grossValue informado sobrescreve o valor', async () => {
    const { movements } = wire()
    const updated = await useCase.execute(MOV_ID, { grossValue: 60 }, CTX)
    expect(updated.grossValue).toBe(60)
    expect(Number(storedDoc(movements).grossValue.toString())).toBe(60)
  })

  it('status informado sobrescreve; sem status preserva o atual', async () => {
    const { movements: m1 } = wire()
    const up1 = await useCase.execute(MOV_ID, { status: 'pending' }, CTX)
    expect(up1.status).toBe('pending')

    const { movements: m2 } = wire()
    const up2 = await useCase.execute(MOV_ID, {}, CTX)
    expect(up2.status).toBe('settled')
    void m1; void m2
  })

  it('history ausente (não-array) inicia um novo histórico', async () => {
    const { movements } = wire({ mov: makeMov({ history: undefined }) })
    await useCase.execute(MOV_ID, {}, CTX)
    const hist = storedDoc(movements).history
    expect(hist).toHaveLength(1)
    expect(hist[0].action).toBe('update')
  })

  it('history existente é preservado e ganha entrada de update', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, {}, CTX)
    const hist = storedDoc(movements).history
    expect(hist).toHaveLength(2)
    expect(hist[1]).toMatchObject({ by: 'u1', action: 'update' })
  })

  it('sem userId no contexto usa "system" no history e updatedBy indefinido', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, {}, { env: 'test', restaurantId: 'r1' } as any)
    const doc = storedDoc(movements)
    expect(doc.history.at(-1).by).toBe('system')
    expect(doc.audit.updatedBy).toBeUndefined()
  })

  it('audit ausente usa "now" como createdAt e createdBy indefinido', async () => {
    const { movements } = wire({ mov: makeMov({ audit: undefined }) })
    await useCase.execute(MOV_ID, {}, CTX)
    const audit = storedDoc(movements).audit
    expect(audit.createdAt).toBeInstanceOf(Date)
    expect(audit.createdBy).toBeUndefined()
  })

  it('conta platform recalcula fee/net e grava snapshot de taxa/prazo', async () => {
    const { movements } = wire({ account: makeAccount({ _id: new ObjectId(ACC_ID), type: 'platform', feePercent: 10, settlementDays: 14 }) })
    const updated = await useCase.execute(MOV_ID, { grossValue: 200 }, CTX)
    expect(updated.netValue).toBe(180)
    expect(updated.feeValue).toBe(20)
    const doc = storedDoc(movements)
    expect(Number(doc.feePercentApplied)).toBe(10)
    expect(doc.settlementDaysApplied).toBe(14)
    expect(doc.predictedReceiptDate).toBeInstanceOf(Date)
  })

  it('conta cash não grava snapshot de taxa/prazo', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, {}, CTX)
    const doc = storedDoc(movements)
    expect(doc.feePercentApplied).toBeUndefined()
    expect(doc.settlementDaysApplied).toBeUndefined()
    expect(doc.predictedReceiptDate).toBeUndefined()
  })

  it('counterparty/fiscalNote/description das mudanças são aplicados', async () => {
    const { movements } = wire()
    await useCase.execute(MOV_ID, { counterparty: { name: 'Cliente', kind: 'client' }, fiscalNote: 'NF-9', description: 'obs' }, CTX)
    const doc = storedDoc(movements)
    expect(doc.counterparty).toEqual({ name: 'Cliente', kind: 'client' })
    expect(doc.fiscalNote).toBe('NF-9')
    expect(doc.description).toBe('obs')
  })

  it('sem counterparty/fiscalNote/description (nem na mov) não grava os campos', async () => {
    const { movements } = wire({ mov: makeMov({ counterparty: undefined, fiscalNote: undefined, description: undefined }) })
    await useCase.execute(MOV_ID, {}, CTX)
    const doc = storedDoc(movements)
    expect('counterparty' in doc).toBe(false)
    expect('fiscalNote' in doc).toBe(false)
    expect('description' in doc).toBe(false)
  })

  it('valores monetários nulos na mov original são tratados como 0 (branch ?? 0)', async () => {
    const { movements } = wire({ mov: makeMov({ grossValue: undefined, netValue: undefined }) })
    const updated = await useCase.execute(MOV_ID, {}, CTX)
    expect(updated.grossValue).toBe(0)
    expect(Number(storedDoc(movements).grossValue.toString())).toBe(0)
  })

  it('corrige o saldo revertendo o antigo e aplicando o novo (updateOne x2)', async () => {
    const { accounts } = wire()
    await useCase.execute(MOV_ID, { grossValue: 60 }, CTX)
    expect(accounts.updateOne).toHaveBeenCalledTimes(2)
    expect(mockSchemaParse).toHaveBeenCalledTimes(1)
  })

  it('erro de validação do schema propaga e encerra a sessão', async () => {
    wire()
    mockSchemaParse.mockImplementation(() => { throw new Error('schema invalido') })
    await expect(useCase.execute(MOV_ID, {}, CTX)).rejects.toThrow('schema invalido')
    expect(session.endSession).toHaveBeenCalled()
  })
})
