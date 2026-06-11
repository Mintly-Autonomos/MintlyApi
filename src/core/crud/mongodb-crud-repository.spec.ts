import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MongodbCrudRepository } from './mongodb-crud-repository'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'
import type { RequestContext } from '../context/request-context'

describe('MongodbCrudRepository.query', () => {
  const ctx: RequestContext = { env: 'test' }
  let repo: MongodbCrudRepository<any, string>

  let aggregateMock: ReturnType<typeof vi.fn>
  let findMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    aggregateMock = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ ok: 1 }]) })
    findMock = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ ok: 2 }]) })

    const collection = { aggregate: aggregateMock, find: findMock }
    const db = { collection: vi.fn().mockReturnValue(collection) }

    vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({
      getDatabase: vi.fn().mockReturnValue(db),
    } as any)

    repo = new MongodbCrudRepository('any-collection')
  })

  it('executa aggregation pipeline pra kind mongo:pipeline', async () => {
    const pipeline = [{ $match: { active: true } }]
    const result = await repo.query<any[]>({ kind: 'mongo:pipeline', pipeline }, ctx)
    expect(aggregateMock).toHaveBeenCalledWith(pipeline)
    expect(result).toEqual([{ ok: 1 }])
  })

  it('executa find pra kind mongo:filter', async () => {
    const filter = { name: 'Ada' }
    const result = await repo.query<any[]>({ kind: 'mongo:filter', filter }, ctx)
    expect(findMock).toHaveBeenCalledWith(filter)
    expect(result).toEqual([{ ok: 2 }])
  })

  it('lança UnsupportedQueryKindError pra kind sql:select', async () => {
    await expect(
      repo.query({ kind: 'sql:select', sql: 'SELECT 1' }, ctx),
    ).rejects.toBeInstanceOf(UnsupportedQueryKindError)
  })
})

// ── Métodos CRUD (com collection mockada) ──────────────────────────────────────

const CTX: RequestContext = { env: 'default' }
const OID = '0123456789abcdef01234567'

function chain (result: any[]) {
  const c: any = {}
  c.sort = vi.fn(() => c)
  c.skip = vi.fn(() => c)
  c.limit = vi.fn(() => c)
  c.toArray = vi.fn().mockResolvedValue(result)
  return c
}

function mockCollection (overrides: Record<string, any> = {}) {
  const collection: any = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: OID }),
    findOne: vi.fn().mockResolvedValue({ _id: OID, name: 'x' }),
    find: vi.fn(() => chain([{ _id: OID }])),
    findOneAndUpdate: vi.fn().mockResolvedValue({ _id: OID, name: 'y' }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  }
  vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({
    getDatabase: vi.fn().mockReturnValue({ collection: () => collection }),
  } as any)
  return collection
}

describe('MongodbCrudRepository (CRUD)', () => {
  let repo: MongodbCrudRepository<any, string>

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new MongodbCrudRepository('things')
  })

  it('insert retorna o item com _id', async () => {
    mockCollection()
    expect((await repo.insert({ name: 'x' } as any, CTX))._id).toBe(OID)
  })

  it('findById retorna o doc', async () => {
    mockCollection()
    expect(await repo.findById(OID, CTX)).toEqual({ _id: OID, name: 'x' })
  })

  it('find retorna via findOne', async () => {
    mockCollection()
    expect(await repo.find({ name: 'x' }, CTX)).toEqual({ _id: OID, name: 'x' })
  })

  it('findAll aplica sort por orderBy e por createdAtDirection', async () => {
    const col = mockCollection()
    const r = await repo.findAll(
      { page: 2, size: 5, orderBy: 'name', orderDirection: 'desc', createdAtDirection: 'asc' } as any,
      CTX,
    )
    expect(r).toEqual([{ _id: OID }])
    expect(col.find).toHaveBeenCalled()
  })

  it('update retorna o doc atualizado', async () => {
    mockCollection()
    expect(await repo.update(OID, { name: 'y' } as any, CTX)).toEqual({ _id: OID, name: 'y' })
  })

  it('update lança quando o id não existe', async () => {
    mockCollection({ findOneAndUpdate: vi.fn().mockResolvedValue(null) })
    await expect(repo.update(OID, { name: 'y' } as any, CTX)).rejects.toThrow()
  })

  it('delete remove quando existe', async () => {
    mockCollection()
    await expect(repo.delete(OID, CTX)).resolves.toBeUndefined()
  })

  it('delete lança quando o id não existe', async () => {
    mockCollection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) })
    await expect(repo.delete(OID, CTX)).rejects.toThrow()
  })
})
