import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FinancialAccountController } from './financial-account-controller'
import { CrudController } from '../../core/crud/crud-controller'

describe('FinancialAccountController', () => {
  let controller: FinancialAccountController
  let mockRepository: any

  beforeEach(() => {
    // 1. Criamos o "Dublê" do Repositório usando funções espiãs do Vitest (vi.fn())
    mockRepository = {
      insert: vi.fn(),
      update: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
    }

    // 2. Injetamos o dublê no Controller (Injeção de Dependência na prática!)
    controller = new FinancialAccountController(mockRepository as any)
  })

  it('deve instanciar o controller corretamente', () => {
    expect(controller).toBeDefined()
  })

  it('deve bloquear a tentativa de atualizar o campo isDefault manualmente', async () => {
    // Aqui nós vamos testar a sua regra de negócio!
    const updatePayload = { name: 'Caixa 2', isDefault: true }

    // Esperamos que, ao chamar o update, ele grite um erro
    await expect(controller.update('id-qualquer', updatePayload))
      .rejects
      .toThrow('BAD_REQUEST: O campo isDefault não pode ser editado manualmente')
  })

  it('deve permitir a atualização de outros campos normalmente', async () => {
    // 1. Criamos um "espião" no Pai. Se o filho chamar o super.update, ele intercepta!
    const superUpdateSpy = vi.spyOn(CrudController.prototype, 'update')
      .mockResolvedValue({ payload: { success: true } } as any)

    // O payload pode ser qualquer coisa, o Pai (espião) não vai validar!
    const updatePayload = { name: 'Novo Nome', status: 'inactive' } as any

    await controller.update('id-qualquer', updatePayload)

    // 2. Verificamos se o filho repassou a bola para o Pai corretamente
    expect(superUpdateSpy).toHaveBeenCalled()

    // 3. Desligamos o espião para não afetar outros testes futuros
    superUpdateSpy.mockRestore()
  })
})
