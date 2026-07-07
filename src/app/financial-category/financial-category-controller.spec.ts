import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FinancialCategoryController } from './financial-category-controller'
import { CrudController } from '../../core/crud/crud-controller'

function mockReply () {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any
}

describe('FinancialCategoryController (MIN-71)', () => {
  let controller: FinancialCategoryController
  let mockRepository: any
  let mockInactivateUseCase: any
  let mockSuggestQuery: any

  beforeEach(() => {
    mockRepository = {
      insert: vi.fn(),
      update: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      find: vi.fn(),
      delete: vi.fn(),
    }
    mockInactivateUseCase = { inactivate: vi.fn(), reactivate: vi.fn() }
    mockSuggestQuery = { execute: vi.fn() }

    controller = new FinancialCategoryController(
      mockRepository as any,
      mockInactivateUseCase as any,
      mockSuggestQuery as any,
    )
  })

  it('deve instanciar o controller corretamente', () => {
    expect(controller).toBeDefined()
  })

  it('deve bloquear a tentativa de editar status pelo update genérico', async () => {
    await expect(controller.update('id-qualquer', { status: 'inactive' } as any))
      .rejects
      .toThrow('O campo status não pode ser editado diretamente')

    expect(mockRepository.find).not.toHaveBeenCalled()
  })

  it('deve bloquear edição de qualquer campo quando a categoria é isSystem', async () => {
    mockRepository.find.mockResolvedValue({ _id: 'cat-1', isSystem: true })

    await expect(controller.update('cat-1', { name: 'Novo nome' }, { env: 'test' } as any))
      .rejects
      .toThrow('Categorias do sistema não podem ser editadas')
  })

  it('deve permitir editar campos de uma categoria custom (não-isSystem)', async () => {
    mockRepository.find.mockResolvedValue({ _id: 'cat-1', isSystem: false })
    const superUpdateSpy = vi.spyOn(CrudController.prototype, 'update')
      .mockResolvedValue({ payload: { success: true } } as any)

    await controller.update('cat-1', { name: 'Novo nome' }, { env: 'test' } as any)

    expect(superUpdateSpy).toHaveBeenCalled()
    superUpdateSpy.mockRestore()
  })

  it('findAll transforma filtro de name em regex case-insensitive', async () => {
    mockRepository.findAll.mockResolvedValue([])
    const superFindAllSpy = vi.spyOn(CrudController.prototype, 'findAll')
      .mockResolvedValue({ payload: [] } as any)

    await controller.findAll({ name: 'venda' })

    expect(superFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: { $regex: 'venda', $options: 'i' } }),
      undefined,
    )
    superFindAllSpy.mockRestore()
  })

  it('inactivate delega para o use-case e responde 200 com mensagem', async () => {
    const request: any = { params: { id: 'cat-1' }, headers: { env: 'test' } }
    const reply = mockReply()

    await controller.inactivate(request, reply)

    expect(mockInactivateUseCase.inactivate).toHaveBeenCalledWith('cat-1', expect.any(Object))
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('reactivate delega para o use-case e responde 200 com mensagem', async () => {
    const request: any = { params: { id: 'cat-1' }, headers: { env: 'test' } }
    const reply = mockReply()

    await controller.reactivate(request, reply)

    expect(mockInactivateUseCase.reactivate).toHaveBeenCalledWith('cat-1', expect.any(Object))
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('suggestions valida direction e delega para a query', async () => {
    mockSuggestQuery.execute.mockResolvedValue([])
    const request: any = { query: { direction: 'in' }, headers: { env: 'test' } }
    const reply = mockReply()

    await controller.suggestions(request, reply)

    expect(mockSuggestQuery.execute).toHaveBeenCalledWith(expect.any(Object), 'in')
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('suggestions rejeita direction inválida com erro de validação', async () => {
    const request: any = { query: { direction: 'sideways' }, headers: { env: 'test' } }
    const reply = mockReply()

    await expect(controller.suggestions(request, reply)).rejects.toThrow()
    expect(mockSuggestQuery.execute).not.toHaveBeenCalled()
  })
})
