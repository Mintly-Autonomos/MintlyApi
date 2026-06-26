import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FinancialAccountController } from './financial-account-controller'
import { CrudController } from '../../core/crud/crud-controller'

describe('FinancialAccountController', () => {
  let controller: FinancialAccountController
  let mockRepository: any
  let mockSetDefaultUseCase: any
  let mockInactivateUseCase: any

  beforeEach(() => {
    // 1. Dublê do Repositório (funções espiãs do Vitest)
    mockRepository = {
      insert: vi.fn(),
      update: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
    }

    // 2. Dublês das use cases injetadas — só precisam do método execute()
    mockSetDefaultUseCase = { execute: vi.fn() }
    mockInactivateUseCase = { execute: vi.fn() }

    // 3. Injetamos os três no Controller (o construtor agora exige todos)
    controller = new FinancialAccountController(
      mockRepository as any,
      mockSetDefaultUseCase as any,
      mockInactivateUseCase as any,
    )
  })

  it('deve instanciar o controller corretamente', () => {
    expect(controller).toBeDefined()
  })

  it('deve bloquear a tentativa de atualizar o campo isDefault manualmente', async () => {
    const updatePayload = { name: 'Caixa 2', isDefault: true }

    // A controller lança ConflictError; checamos o trecho da mensagem que importa.
    await expect(controller.update('id-qualquer', updatePayload))
      .rejects
      .toThrow('O campo isDefault não pode ser editado manualmente')
  })

  it('deve permitir a atualização de outros campos normalmente', async () => {
    // Espião no Pai: se o filho chamar super.update, ele intercepta.
    const superUpdateSpy = vi.spyOn(CrudController.prototype, 'update')
      .mockResolvedValue({ payload: { success: true } } as any)

    const updatePayload = { name: 'Novo Nome', status: 'inactive' } as any

    await controller.update('id-qualquer', updatePayload)

    expect(superUpdateSpy).toHaveBeenCalled()

    superUpdateSpy.mockRestore()
  })
})
