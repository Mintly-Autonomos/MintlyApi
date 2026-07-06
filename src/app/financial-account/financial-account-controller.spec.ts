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

  describe('findAll (busca textual)', () => {
    it('escapa metacaracteres de regex no filtro name antes de montar o $regex', async () => {
      const superFindAllSpy = vi.spyOn(CrudController.prototype, 'findAll')
        .mockResolvedValue({ payload: [] } as any)

      // '.' e '*' são metacaracteres — devem ser escapados (regex injection / ReDoS).
      await controller.findAll({ name: 'Caixa.2*', status: 'active' })

      const passedFilter = superFindAllSpy.mock.calls[0][0]
      expect(passedFilter.name).toEqual({ $regex: 'Caixa\\.2\\*', $options: 'i' })
      // demais filtros preservados
      expect(passedFilter.status).toBe('active')

      superFindAllSpy.mockRestore()
    })

    it('não mexe no filtro quando name está ausente', async () => {
      const superFindAllSpy = vi.spyOn(CrudController.prototype, 'findAll')
        .mockResolvedValue({ payload: [] } as any)

      const filter = { status: 'active' }
      await controller.findAll(filter)

      expect(superFindAllSpy).toHaveBeenCalledWith(filter, undefined)
      superFindAllSpy.mockRestore()
    })
  })

  describe('setDefault (rota transacional)', () => {
    it('executa a use case com o id e o contexto e responde 200', async () => {
      mockSetDefaultUseCase.execute.mockResolvedValue(undefined)
      const request = {
        params: { id: 'acc-1' },
        headers: { env: 'test' },
        jwtClaims: { subject: 'user-1', claims: { restaurantId: ['rest-1'] } },
      }
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnValue('sent') }

      const result = await controller.setDefault(request, reply as any)

      expect(mockSetDefaultUseCase.execute).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({ userId: 'user-1', restaurantId: 'rest-1' }),
      )
      expect(reply.status).toHaveBeenCalledWith(200)
      expect(reply.send).toHaveBeenCalledWith({ payload: { message: 'Conta definida como padrão com sucesso.' } })
      expect(result).toBe('sent')
    })
  })

  describe('inactivate (rota transacional)', () => {
    it('repassa o replacementDefaultId do body para a use case e responde 200', async () => {
      mockInactivateUseCase.execute.mockResolvedValue(undefined)
      const request = {
        params: { id: 'acc-1' },
        body: { replacementDefaultId: 'acc-2' },
        headers: { env: 'test' },
        jwtClaims: { subject: 'user-1', claims: { restaurantId: ['rest-1'] } },
      }
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnValue('sent') }

      await controller.inactivate(request, reply as any)

      expect(mockInactivateUseCase.execute).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({ userId: 'user-1', restaurantId: 'rest-1' }),
        'acc-2',
      )
      expect(reply.status).toHaveBeenCalledWith(200)
      expect(reply.send).toHaveBeenCalledWith({ payload: { message: 'Conta inativada com sucesso.' } })
    })

    it('passa replacementDefaultId undefined quando o body está ausente', async () => {
      mockInactivateUseCase.execute.mockResolvedValue(undefined)
      const request = {
        params: { id: 'acc-1' },
        // sem body — testa o fallback (request.body ?? {})
        headers: { env: 'test' },
      }
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnValue('sent') }

      await controller.inactivate(request, reply as any)

      expect(mockInactivateUseCase.execute).toHaveBeenCalledWith(
        'acc-1',
        expect.any(Object),
        undefined,
      )
    })
  })
})
