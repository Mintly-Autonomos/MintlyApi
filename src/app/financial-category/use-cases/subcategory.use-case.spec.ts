import { describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { SubcategoryUseCase } from './subcategory.use-case'

const ctx = { env: 'test', restaurantId: 'r1', userId: 'u1' } as any

describe('SubcategoryUseCase — concorrência', () => {
  it('relê e tenta de novo quando a categoria mudou no meio; grava na segunda', async () => {
    const repo = {
      find: vi.fn().mockResolvedValue({ subcategories: [] }),
      pushSubcategory: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    }
    const sub = await new SubcategoryUseCase(repo as any).add(new ObjectId().toHexString(), { name: 'Frango' }, ctx)

    expect(sub.name).toBe('Frango')
    expect(repo.find).toHaveBeenCalledTimes(2)
  })

  it('desiste com 409 se a categoria muda em todas as tentativas', async () => {
    const repo = { find: vi.fn().mockResolvedValue({ subcategories: [] }), pushSubcategory: vi.fn().mockResolvedValue(false) }

    await expect(new SubcategoryUseCase(repo as any).add(new ObjectId().toHexString(), { name: 'Frango' }, ctx)).rejects.toThrow(ConflictError)
    expect(repo.pushSubcategory).toHaveBeenCalledTimes(5)
  })
})
