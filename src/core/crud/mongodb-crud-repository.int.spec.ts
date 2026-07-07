import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongodbCrudRepository } from './mongodb-crud-repository'
import { startInMemoryMongo, stopInMemoryMongo, clearAllDatabases } from '../../../tests/helpers/in-memory-mongo'
import type { RequestContext } from '../context/request-context'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'

describe('MongodbCrudRepository (integration)', () => {
  const ctx: RequestContext = { env: 'int-test-query' }
  let repo: MongodbCrudRepository<{ name: string, age: number }, string>

  beforeAll(async () => {
    await startInMemoryMongo()
    repo = new MongodbCrudRepository('people')
  })

  afterAll(async () => {
    await stopInMemoryMongo()
  })

  beforeEach(async () => {
    await clearAllDatabases()
  })

  it('query mongo:pipeline executa aggregation', async () => {
    await repo.insert({ name: 'Ada', age: 30 } as any, ctx)
    await repo.insert({ name: 'Bob', age: 40 } as any, ctx)

    const result = await repo.query<any[]>(
      { kind: 'mongo:pipeline', pipeline: [{ $match: { age: { $gte: 35 } } }] },
      ctx,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Bob' })
  })

  it('query mongo:filter executa find', async () => {
    await repo.insert({ name: 'Ada', age: 30 } as any, ctx)
    await repo.insert({ name: 'Bob', age: 40 } as any, ctx)

    const result = await repo.query<any[]>(
      { kind: 'mongo:filter', filter: { name: 'Ada' } },
      ctx,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Ada' })
  })

  it('query sql:select lança UnsupportedQueryKindError', async () => {
    await expect(
      repo.query({ kind: 'sql:select', sql: 'SELECT 1' }, ctx),
    ).rejects.toBeInstanceOf(UnsupportedQueryKindError)
  })

  it('find devolve apenas a entity matching o filter', async () => {
    await repo.insert({ name: 'Ada', age: 30 } as any, ctx)
    await repo.insert({ name: 'Bob', age: 40 } as any, ctx)

    const result = await repo.find({ name: 'Bob' }, ctx)
    expect(result).toMatchObject({ name: 'Bob', age: 40 })
  })

  it('findAll com paginação retorna a slice correta', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.insert({ name: `P${i}`, age: i } as any, ctx)
    }

    const page1 = await repo.findAll({ page: 1, size: 2 }, ctx)
    expect(page1).toHaveLength(2)

    const page3 = await repo.findAll({ page: 3, size: 2 }, ctx)
    expect(page3).toHaveLength(1)
  })

  it('findAll com orderBy aplica sort', async () => {
    await repo.insert({ name: 'C', age: 3 } as any, ctx)
    await repo.insert({ name: 'A', age: 1 } as any, ctx)
    await repo.insert({ name: 'B', age: 2 } as any, ctx)

    const asc = await repo.findAll({ page: 1, size: 10, orderBy: 'age', orderDirection: 'asc' }, ctx)
    expect(asc.map(p => p.name)).toEqual(['A', 'B', 'C'])

    const desc = await repo.findAll({ page: 1, size: 10, orderBy: 'age', orderDirection: 'desc' }, ctx)
    expect(desc.map(p => p.name)).toEqual(['C', 'B', 'A'])
  })

  it('findAll com createdAtDirection aplica sort em createdAt', async () => {
    await repo.insert({ name: 'A', age: 1, createdAt: new Date('2024-01-01') } as any, ctx)
    await repo.insert({ name: 'B', age: 2, createdAt: new Date('2024-02-01') } as any, ctx)

    const desc = await repo.findAll({ page: 1, size: 10, createdAtDirection: 'desc' }, ctx)
    expect(desc[0].name).toBe('B')

    const asc = await repo.findAll({ page: 1, size: 10, createdAtDirection: 'asc' }, ctx)
    expect(asc[0].name).toBe('A')
  })

  it('update com id inexistente lança Error', async () => {
    await expect(
      repo.update('507f1f77bcf86cd799439011', { name: 'Nope' }, ctx),
    ).rejects.toThrow(/não encontrado/)
  })

  it('delete com id inexistente lança Error', async () => {
    await expect(
      repo.delete('507f1f77bcf86cd799439011', ctx),
    ).rejects.toThrow(/não encontrado/)
  })

  describe('escopo por tenant (restaurantId)', () => {
    const ctxA: RequestContext = { env: 'int-test-query', restaurantId: 'rest-A' }
    const ctxB: RequestContext = { env: 'int-test-query', restaurantId: 'rest-B' }
    let tenantRepo: MongodbCrudRepository<{ name: string, restaurantId?: string }, string>

    beforeAll(() => {
      tenantRepo = new MongodbCrudRepository('tenant_people')
    })

    const idOf = (doc: any): string => String(doc._id)

    it('insert injeta o restaurantId do contexto e ignora o do body (anti-injeção)', async () => {
      const doc = await tenantRepo.insert({ name: 'Ada', restaurantId: 'rest-B' } as any, ctxA)
      expect((doc as any).restaurantId).toBe('rest-A')
    })

    it('findById não enxerga doc de outro tenant', async () => {
      const a = await tenantRepo.insert({ name: 'Ada' } as any, ctxA)
      expect(await tenantRepo.findById(idOf(a), ctxA)).toMatchObject({ name: 'Ada' })
      expect(await tenantRepo.findById(idOf(a), ctxB)).toBeNull()
    })

    it('findAll lista só o tenant do contexto', async () => {
      await tenantRepo.insert({ name: 'A1' } as any, ctxA)
      await tenantRepo.insert({ name: 'A2' } as any, ctxA)
      await tenantRepo.insert({ name: 'B1' } as any, ctxB)
      expect(await tenantRepo.findAll({ page: 1, size: 10 }, ctxA)).toHaveLength(2)
      expect(await tenantRepo.findAll({ page: 1, size: 10 }, ctxB)).toHaveLength(1)
    })

    it('update não altera doc de outro tenant (não encontrado) e mantém o original intacto', async () => {
      const a = await tenantRepo.insert({ name: 'Ada' } as any, ctxA)
      await expect(tenantRepo.update(idOf(a), { name: 'Hacked' }, ctxB)).rejects.toThrow(/não encontrado/)
      expect(await tenantRepo.findById(idOf(a), ctxA)).toMatchObject({ name: 'Ada' })
    })

    it('delete não apaga doc de outro tenant', async () => {
      const a = await tenantRepo.insert({ name: 'Ada' } as any, ctxA)
      await expect(tenantRepo.delete(idOf(a), ctxB)).rejects.toThrow(/não encontrado/)
      expect(await tenantRepo.findById(idOf(a), ctxA)).toMatchObject({ name: 'Ada' })
    })
  })
})
