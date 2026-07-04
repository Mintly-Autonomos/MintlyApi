import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InactivateCategoryUseCase } from './inactivate-category.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import type { RequestContext } from '../../../core/context/request-context'

const h = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../financial-category-repository', () => ({
  FinancialCategoryRepository: class {
    find = h.find
    update = h.update
  },
}))

const CTX: RequestContext = { env: 'test', userId: 'user-1', restaurantId: 'rest-1' }

const ACTIVE_CATEGORY = {
  _id: 'cat-1',
  name: 'Venda Balcão',
  type: 'revenue',
  status: 'active',
  isSystem: false,
  restaurantId: 'rest-1',
  history: [],
}

describe('InactivateCategoryUseCase (MIN-71)', () => {
  let sut: InactivateCategoryUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    h.update.mockResolvedValue(undefined)
    sut = new InactivateCategoryUseCase()
  })

  describe('inactivate', () => {
    it('isola a busca por restaurantId — multi-tenant', async () => {
      h.find.mockResolvedValueOnce(ACTIVE_CATEGORY)

      await sut.inactivate('cat-1', CTX)

      expect(h.find).toHaveBeenCalledWith({ _id: 'cat-1', restaurantId: 'rest-1' }, CTX)
    })

    it('seta status inactive e registra entrada de auditoria no history', async () => {
      h.find.mockResolvedValueOnce(ACTIVE_CATEGORY)

      await sut.inactivate('cat-1', CTX)

      expect(h.update).toHaveBeenCalledTimes(1)
      const [id, payload, ctx] = h.update.mock.calls[0]
      expect(id).toBe('cat-1')
      expect(payload.status).toBe('inactive')
      expect(payload.history).toHaveLength(1)
      expect(payload.history[0]).toMatchObject({ by: 'user-1', action: 'inactivate' })
      expect(payload.history[0].at instanceof Date).toBe(true)
      expect(ctx).toBe(CTX)
    })

    it('funciona em categoria isSystem — só o status muda, sem guard extra', async () => {
      h.find.mockResolvedValueOnce({ ...ACTIVE_CATEGORY, isSystem: true })

      await sut.inactivate('cat-1', CTX)

      expect(h.update).toHaveBeenCalledTimes(1)
    })

    it('usa "system" como autor quando ctx.userId está ausente', async () => {
      const CTX_NO_USER: RequestContext = { env: 'test', restaurantId: 'rest-1' }
      h.find.mockResolvedValueOnce(ACTIVE_CATEGORY)

      await sut.inactivate('cat-1', CTX_NO_USER)

      const [, payload] = h.update.mock.calls[0]
      expect(payload.history[0].by).toBe('system')
    })

    it('é idempotente: categoria já inativa não escreve nada', async () => {
      h.find.mockResolvedValueOnce({ ...ACTIVE_CATEGORY, status: 'inactive' })

      await sut.inactivate('cat-1', CTX)

      expect(h.update).not.toHaveBeenCalled()
    })

    it('lança NotFoundError quando a categoria não existe', async () => {
      h.find.mockResolvedValueOnce(null)

      await expect(sut.inactivate('missing', CTX)).rejects.toBeInstanceOf(NotFoundError)
      expect(h.update).not.toHaveBeenCalled()
    })
  })

  describe('reactivate', () => {
    it('seta status active e registra entrada de auditoria com action reactivate', async () => {
      h.find.mockResolvedValueOnce({ ...ACTIVE_CATEGORY, status: 'inactive' })

      await sut.reactivate('cat-1', CTX)

      expect(h.update).toHaveBeenCalledTimes(1)
      const [, payload] = h.update.mock.calls[0]
      expect(payload.status).toBe('active')
      expect(payload.history[0]).toMatchObject({ by: 'user-1', action: 'reactivate' })
    })

    it('é idempotente: categoria já ativa não escreve nada', async () => {
      h.find.mockResolvedValueOnce(ACTIVE_CATEGORY)

      await sut.reactivate('cat-1', CTX)

      expect(h.update).not.toHaveBeenCalled()
    })

    it('lança NotFoundError quando a categoria não existe', async () => {
      h.find.mockResolvedValueOnce(null)

      await expect(sut.reactivate('missing', CTX)).rejects.toBeInstanceOf(NotFoundError)
      expect(h.update).not.toHaveBeenCalled()
    })
  })
})
