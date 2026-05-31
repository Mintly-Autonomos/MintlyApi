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
