import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SuggestCategoriesQuery } from './suggest-categories.query'
import { MovementDirection, CategoryType } from 'mintly-lib'
import type { RequestContext } from '../../../core/context/request-context'

const h = vi.hoisted(() => ({ findSuggestions: vi.fn() }))

vi.mock('../financial-category-repository', () => ({
  FinancialCategoryRepository: class {
    findSuggestions = h.findSuggestions
  },
}))

const CTX: RequestContext = { env: 'test', restaurantId: 'rest-1' }

describe('SuggestCategoriesQuery (MIN-71)', () => {
  let sut: SuggestCategoriesQuery

  beforeEach(() => {
    vi.clearAllMocks()
    sut = new SuggestCategoriesQuery()
  })

  it('direction "in" busca categorias do tipo revenue', async () => {
    h.findSuggestions.mockResolvedValueOnce([])

    await sut.execute(CTX, MovementDirection.In)

    expect(h.findSuggestions).toHaveBeenCalledWith(CTX, CategoryType.Revenue)
  })

  it('direction "out" busca categorias do tipo expense', async () => {
    h.findSuggestions.mockResolvedValueOnce([])

    await sut.execute(CTX, MovementDirection.Out)

    expect(h.findSuggestions).toHaveBeenCalledWith(CTX, CategoryType.Expense)
  })

  it('retorna o resultado do repositório sem transformação', async () => {
    const categories = [{ _id: 'cat-1', name: 'Venda Balcão' }]
    h.findSuggestions.mockResolvedValueOnce(categories)

    const result = await sut.execute(CTX, MovementDirection.In)

    expect(result).toBe(categories)
  })
})
