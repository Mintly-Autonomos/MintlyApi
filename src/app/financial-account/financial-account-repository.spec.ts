import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MongoServerError } from 'mongodb'
import { FinancialAccountRepository } from './financial-account-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import type { RequestContext } from '../../core/context/request-context'

/**
 * Testes unitários — FinancialAccountRepository
 *
 * Cobre os overrides desta collection (sem tocar no Mongo real):
 *  - insert: tenant scoping forçado, saldos -> Decimal128 (com default ?? 0),
 *    leitura de volta em number e tradução de 11000 -> ConflictError.
 *  - findAll: paginação/coerção, remoção de chaves de paginação do filtro,
 *    tenant scoping, collation pt e conversão de saldos.
 *  - createIndexes: delega para a fonte única de índices.
 */

// --- Mocks "hoisted" ---
const h = vi.hoisted(() => {
  const toArray = vi.fn()
  const cursor: any = {}
  cursor.collation = vi.fn(() => cursor)
  cursor.sort = vi.fn(() => cursor)
  cursor.skip = vi.fn(() => cursor)
  cursor.limit = vi.fn(() => cursor)
  cursor.toArray = toArray

  const insertOne = vi.fn()
  const find = vi.fn(() => cursor)
  const collection = vi.fn(() => ({ insertOne, find }))
  const ensure = vi.fn()

  return { toArray, cursor, insertOne, find, collection, ensure }
})

// getCollection do repo base: MongoDBConnection.getInstance().getDatabase(env).collection(name)
vi.mock('../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: vi.fn(() => ({
      getDatabase: vi.fn(() => ({ collection: h.collection })),
    })),
  },
}))

// createIndexes delega para a fonte única (ensure).
vi.mock('../../infrastructure/db/indices/financial-accounts', () => ({
  ensure: h.ensure,
}))

const CTX: RequestContext = { env: 'test', userId: 'user-1', restaurantId: 'rest-1' }

describe('FinancialAccountRepository', () => {
  let repo: FinancialAccountRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new FinancialAccountRepository()
  })

  describe('insert', () => {
    it('força o restaurantId do contexto e persiste saldos ausentes como Decimal128("0.00")', async () => {
      h.insertOne.mockResolvedValue({ insertedId: 'id-novo' })

      // restaurantId do payload deve ser IGNORADO; saldos ausentes -> 0
      const result = await repo.insert(
        { name: 'Caixa', type: 'cash', restaurantId: 'outro-rest' } as any,
        CTX,
      )

      const scoped = h.insertOne.mock.calls[0][0]
      expect(scoped.restaurantId).toBe('rest-1')
      expect(scoped.availableBalance.toString()).toBe('0.00')
      expect(scoped.predictedBalance.toString()).toBe('0.00')

      // leitura de volta: Decimal128 -> number, _id do resultado do insert
      expect(result.availableBalance).toBe(0)
      expect(result.predictedBalance).toBe(0)
      expect((result as any)._id).toBe('id-novo')
    })

    it('converte saldos informados para Decimal128 e os devolve como number', async () => {
      h.insertOne.mockResolvedValue({ insertedId: 'id-2' })

      const result = await repo.insert(
        { name: 'Banco', type: 'bank', availableBalance: 100.5, predictedBalance: 50 } as any,
        CTX,
      )

      const scoped = h.insertOne.mock.calls[0][0]
      expect(scoped.availableBalance.toString()).toBe('100.50')
      expect(scoped.predictedBalance.toString()).toBe('50.00')
      expect(result.availableBalance).toBe(100.5)
      expect(result.predictedBalance).toBe(50)
    })

    it('traduz o erro 11000 (índice unique) em ConflictError', async () => {
      const dup = new MongoServerError({ message: 'E11000 duplicate key' })
      ;(dup as any).code = 11000
      h.insertOne.mockRejectedValue(dup)

      await expect(repo.insert({ name: 'Caixa', type: 'cash' } as any, CTX))
        .rejects.toBeInstanceOf(ConflictError)
    })

    it('repassa MongoServerError com código diferente de 11000 sem traduzir', async () => {
      const other = new MongoServerError({ message: 'writeConflict' })
      ;(other as any).code = 112
      h.insertOne.mockRejectedValue(other)

      await expect(repo.insert({ name: 'Caixa', type: 'cash' } as any, CTX))
        .rejects.toBe(other)
    })

    it('repassa erros desconhecidos (não-MongoServerError) sem traduzir', async () => {
      const boom = new Error('boom')
      h.insertOne.mockRejectedValue(boom)

      await expect(repo.insert({ name: 'Caixa', type: 'cash' } as any, CTX))
        .rejects.toBe(boom)
    })
  })

  describe('findAll', () => {
    it('usa paginação default, isola por restaurantId e aplica collation pt', async () => {
      h.toArray.mockResolvedValue([])

      await repo.findAll({}, CTX)

      // filtro real: apenas o tenant scoping (sem chaves de paginação)
      expect(h.find).toHaveBeenCalledWith({ restaurantId: 'rest-1' })
      expect(h.cursor.collation).toHaveBeenCalledWith({ locale: 'pt', strength: 1 })
      expect(h.cursor.sort).toHaveBeenCalledWith({ status: 1, name: 1 })
      expect(h.cursor.skip).toHaveBeenCalledWith(0)
      expect(h.cursor.limit).toHaveBeenCalledWith(10)
    })

    it('remove chaves de paginação/controle do filtro e coage page/size string', async () => {
      h.toArray.mockResolvedValue([])

      await repo.findAll(
        {
          page: '2',
          size: '5',
          orderBy: 'name',
          orderDirection: 'desc',
          createdAtDirection: 'asc',
          isMultipleResponse: 'true',
          status: 'active',
        } as any,
        CTX,
      )

      // só sobram os filtros reais + tenant
      expect(h.find).toHaveBeenCalledWith({ status: 'active', restaurantId: 'rest-1' })
      expect(h.cursor.skip).toHaveBeenCalledWith(5) // (2-1)*5
      expect(h.cursor.limit).toHaveBeenCalledWith(5)
    })

    it('cai para page=1/size=10 quando os valores não são numéricos (|| fallback)', async () => {
      h.toArray.mockResolvedValue([])

      await repo.findAll({ page: 'abc', size: 'xyz' } as any, CTX)

      expect(h.cursor.skip).toHaveBeenCalledWith(0)
      expect(h.cursor.limit).toHaveBeenCalledWith(10)
    })

    it('converte os saldos dos documentos retornados para number', async () => {
      h.toArray.mockResolvedValue([
        { name: 'Caixa', availableBalance: '100.50', predictedBalance: 50 },
      ])

      const result = await repo.findAll({}, CTX)

      expect(result[0].availableBalance).toBe(100.5)
      expect(result[0].predictedBalance).toBe(50)
    })
  })

  describe('createIndexes', () => {
    it('delega para a fonte única de índices (ensure)', async () => {
      await repo.createIndexes(CTX)
      expect(h.ensure).toHaveBeenCalledTimes(1)
    })
  })
})
