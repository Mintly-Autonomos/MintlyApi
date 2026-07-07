import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logAudit } from './audit-service'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'

function mockCollection (insertOne: any) {
  const collection: any = { insertOne }
  const collectionFn = vi.fn().mockReturnValue(collection)
  const db = { collection: collectionFn }
  const getDatabase = vi.fn().mockReturnValue(db)
  vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({ getDatabase } as any)
  return { collection, collectionFn, getDatabase }
}

describe('logAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('insere o documento de auditoria na coleção audit_logs', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc' })
    const { collectionFn } = mockCollection(insertOne)

    const before = Date.now()
    await logAudit('login', 'user-1', 'env-x', 'rest-9', { ip: '10.0.0.1' })
    const after = Date.now()

    expect(collectionFn).toHaveBeenCalledWith('audit_logs')
    expect(insertOne).toHaveBeenCalledTimes(1)

    const entry = insertOne.mock.calls[0][0]
    expect(entry.event).toBe('login')
    expect(entry.userId).toBe('user-1')
    expect(entry.restaurantId).toBe('rest-9')
    expect(entry.data).toEqual({ ip: '10.0.0.1' })
    expect(entry.createdAt).toBeInstanceOf(Date)
    expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(entry.createdAt.getTime()).toBeLessThanOrEqual(after)
  })

  it('usa data vazia por padrão e resolve o env informado ao pegar a coleção', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc' })
    const { getDatabase } = mockCollection(insertOne)

    await logAudit('logout', 'user-2', 'staging', undefined)

    expect(getDatabase).toHaveBeenCalledWith('staging')
    const entry = insertOne.mock.calls[0][0]
    expect(entry.data).toEqual({})
    expect(entry.restaurantId).toBeUndefined()
  })

  it('não lança quando insertOne rejeita (engole o erro via .catch)', async () => {
    const insertOne = vi.fn().mockRejectedValue(new Error('mongo indisponível'))
    mockCollection(insertOne)

    await expect(logAudit('login_failed', 'user-3', 'test-env', undefined)).resolves.toBeUndefined()
    expect(insertOne).toHaveBeenCalledTimes(1)
  })
})
