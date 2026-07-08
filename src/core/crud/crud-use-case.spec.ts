import { describe, it, expect, vi } from 'vitest'
import { CrudUseCase } from './crud-use-case'
import type { CrudRepository } from './crud-repository-interface'
import type { RequestContext } from '../context/request-context'

describe('CrudUseCase', () => {
  const ctx: RequestContext = { env: 'unit' }

  function mockRepo<T> (): CrudRepository<T, string> {
    return {
      insert: vi.fn().mockResolvedValue({ ok: 'insert' }),
      findById: vi.fn().mockResolvedValue({ ok: 'findById' }),
      find: vi.fn().mockResolvedValue({ ok: 'find' }),
      findAll: vi.fn().mockResolvedValue([{ ok: 'findAll' }]),
      count: vi.fn().mockResolvedValue(42),
      update: vi.fn().mockResolvedValue({ ok: 'update' }),
      delete: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([{ ok: 'query' }]),
    } as any
  }

  it('insert enriquece o item com audit do servidor e delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    const ctxWithUser: RequestContext = { env: 'unit', userId: 'user-1' }

    const result = await useCase.insert({ a: 1 } as any, ctxWithUser)

    expect(repo.insert).toHaveBeenCalledTimes(1)
    const [item, passedCtx] = (repo.insert as any).mock.calls[0]
    expect(item.a).toBe(1)
    expect(item.audit.createdBy).toBe('user-1')
    expect(item.audit.updatedBy).toBe('user-1')
    expect(item.audit.createdAt instanceof Date).toBe(true)
    expect(item.audit.updatedAt instanceof Date).toBe(true)
    expect(passedCtx).toBe(ctxWithUser)
    expect(result).toEqual({ ok: 'insert' })
  })

  it('findById delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    await useCase.findById('id-1', ctx)
    expect(repo.findById).toHaveBeenCalledWith('id-1', ctx)
  })

  it('find delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    await useCase.find({ name: 'A' } as any, ctx)
    expect(repo.find).toHaveBeenCalledWith({ name: 'A' }, ctx)
  })

  it('findAll delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    await useCase.findAll({ page: 1, size: 10 } as any, ctx)
    expect(repo.findAll).toHaveBeenCalledWith({ page: 1, size: 10 }, ctx)
  })

  it('count delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    const total = await useCase.count({ page: 1, size: 10 } as any, ctx)
    expect(repo.count).toHaveBeenCalledWith({ page: 1, size: 10 }, ctx)
    expect(total).toBe(42)
  })

  it('update renova a auditoria (dot-notation) e delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    const ctxWithUser: RequestContext = { env: 'unit', userId: 'user-9' }

    await useCase.update('id-1', { name: 'A' } as any, ctxWithUser)

    expect(repo.update).toHaveBeenCalledTimes(1)
    const [id, item, passedCtx] = (repo.update as any).mock.calls[0]
    expect(id).toBe('id-1')
    expect(item.name).toBe('A')
    expect(item['audit.updatedBy']).toBe('user-9')
    expect(item['audit.updatedAt'] instanceof Date).toBe(true)
    expect(passedCtx).toBe(ctxWithUser)
  })

  it('update descarta campos autoritativos do servidor (audit/restaurantId/_id)', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)

    await useCase.update(
      'id-1',
      { name: 'A', audit: { createdBy: 'forjado' }, restaurantId: 'outro', _id: 'x' } as any,
      ctx,
    )

    const [, item] = (repo.update as any).mock.calls[0]
    expect(item.name).toBe('A')
    expect(item.restaurantId).toBeUndefined()
    expect(item._id).toBeUndefined()
    // audit só existe via dot-notation renovada pelo servidor, nunca o objeto do client.
    expect(item.audit).toBeUndefined()
    expect(item['audit.updatedAt'] instanceof Date).toBe(true)
  })

  it('delete delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    await useCase.delete('id-1', ctx)
    expect(repo.delete).toHaveBeenCalledWith('id-1', ctx)
  })

  it('query delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    await useCase.query({ kind: 'mongo:filter', filter: {} }, ctx)
    expect(repo.query).toHaveBeenCalledWith({ kind: 'mongo:filter', filter: {} }, ctx)
  })
})
