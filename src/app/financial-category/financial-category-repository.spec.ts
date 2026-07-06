import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MongoServerError } from 'mongodb'
import { FinancialCategoryRepository } from './financial-category-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import type { RequestContext } from '../../core/context/request-context'

const CTX: RequestContext = { env: 'unit', restaurantId: 'rest-1' } as RequestContext

/** Collection fake para o insert: captura o doc inserido e permite forçar erro. */
function mockInsertCollection (opts: { throwErr?: unknown } = {}) {
  const captured: any = {}
  const collection = {
    insertOne: vi.fn(async (doc: any) => {
      captured.doc = doc
      if (opts.throwErr) throw opts.throwErr
      return { insertedId: 'new-id' }
    }),
  }
  return { collection, captured }
}

/** Collection fake para o findAll: captura o filtro e a chain do Mongo. */
function mockFindCollection () {
  const captured: any = {}
  const chain = {
    find: vi.fn((filter: any) => { captured.filter = filter; return chain }),
    collation: vi.fn(() => chain),
    sort: vi.fn((sort: any) => { captured.sort = sort; return chain }),
    skip: vi.fn((n: number) => { captured.skip = n; return chain }),
    limit: vi.fn((n: number) => { captured.limit = n; return chain }),
    toArray: vi.fn(async () => []),
  }
  return { chain, captured }
}

describe('FinancialCategoryRepository', () => {
  let repo: FinancialCategoryRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new FinancialCategoryRepository()
  })

  describe('insert (override)', () => {
    it('força restaurantId do ctx, isSystem=false, usage=0 e history=[] ignorando o body', async () => {
      const { collection, captured } = mockInsertCollection()
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(collection as any)

      await repo.insert(
        { name: 'Vendas', type: 'in', restaurantId: 'OUTRO', isSystem: true, usage: 999, history: [{ x: 1 }] } as any,
        CTX,
      )

      expect(captured.doc.restaurantId).toBe('rest-1')
      expect(captured.doc.isSystem).toBe(false)
      expect(captured.doc.usage).toBe(0)
      expect(captured.doc.history).toEqual([])
    })

    it('traduz erro 11000 (índice unique name+type) do Mongo em ConflictError', async () => {
      const dupError = new MongoServerError({ message: 'E11000 duplicate key' })
      ;(dupError as any).code = 11000
      const { collection } = mockInsertCollection({ throwErr: dupError })
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(collection as any)

      await expect(repo.insert({ name: 'Vendas', type: 'in' } as any, CTX))
        .rejects
        .toBeInstanceOf(ConflictError)
    })

    it('propaga MongoServerError com code != 11000 sem traduzir', async () => {
      const otherMongoError = new MongoServerError({ message: 'algo diferente' })
      ;(otherMongoError as any).code = 121
      const { collection } = mockInsertCollection({ throwErr: otherMongoError })
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(collection as any)

      await expect(repo.insert({ name: 'Vendas', type: 'in' } as any, CTX))
        .rejects
        .toBe(otherMongoError)
    })

    it('propaga erro não-Mongo (não é MongoServerError) sem traduzir', async () => {
      const genericError = new Error('boom')
      const { collection } = mockInsertCollection({ throwErr: genericError })
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(collection as any)

      await expect(repo.insert({ name: 'Vendas', type: 'in' } as any, CTX))
        .rejects
        .toBe(genericError)
    })
  })

  describe('findAll (override)', () => {
    it('escopa por restaurantId e remove campos de controle do filtro (isMultipleResponse etc.)', async () => {
      const { chain, captured } = mockFindCollection()
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(chain as any)

      await repo.findAll({ isMultipleResponse: true, orderBy: 'name', name: 'venda' }, CTX)

      expect(captured.filter).toEqual({ name: 'venda', restaurantId: 'rest-1' })
      expect(captured.filter.isMultipleResponse).toBeUndefined()
      expect(captured.filter.orderBy).toBeUndefined()
      expect(captured.sort).toEqual({ status: 1, name: 1 })
    })

    it('page/size inválidos (NaN) caem nos defaults 1 e 10 (skip=0, limit=10)', async () => {
      const { chain, captured } = mockFindCollection()
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(chain as any)

      await repo.findAll({ page: 'abc', size: 'xyz' }, CTX)

      expect(captured.skip).toBe(0)
      expect(captured.limit).toBe(10)
    })

    it('page/size válidos definem skip e limit corretamente', async () => {
      const { chain, captured } = mockFindCollection()
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(chain as any)

      await repo.findAll({ page: '3', size: '5' }, CTX)

      // skip = (3-1)*5 = 10
      expect(captured.skip).toBe(10)
      expect(captured.limit).toBe(5)
    })
  })

  describe('findSuggestions', () => {
    it('filtra por restaurante/status active/type, ordena por recência+frequência e usa limit default 10', async () => {
      const { chain, captured } = mockFindCollection()
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(chain as any)

      await repo.findSuggestions(CTX, 'in' as any)

      expect(captured.filter).toEqual({
        restaurantId: 'rest-1',
        status: 'active',
        type: 'in',
      })
      expect(captured.sort).toEqual({ lastUsedAt: -1, usage: -1 })
      expect(captured.limit).toBe(10)
    })

    it('respeita o limit explícito quando informado', async () => {
      const { chain, captured } = mockFindCollection()
      vi.spyOn(repo as any, 'getCollection').mockReturnValue(chain as any)

      await repo.findSuggestions(CTX, 'out' as any, 3)

      expect(captured.filter.type).toBe('out')
      expect(captured.limit).toBe(3)
    })
  })
})
