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
      update: vi.fn().mockResolvedValue({ ok: 'update' }),
      delete: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([{ ok: 'query' }]),
    } as any
  }

  it('insert delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    const result = await useCase.insert({ a: 1 } as any, ctx)
    expect(repo.insert).toHaveBeenCalledWith({ a: 1 }, ctx)
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

  it('update delega pro repository', async () => {
    const repo = mockRepo()
    const useCase = new CrudUseCase(repo)
    await useCase.update('id-1', { name: 'A' } as any, ctx)
    expect(repo.update).toHaveBeenCalledWith('id-1', { name: 'A' }, ctx)
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
