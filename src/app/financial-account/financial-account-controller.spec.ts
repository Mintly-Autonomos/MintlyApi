import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  describe('update: histórico da conta', () => {
    const source = { headers: { env: 'test' }, jwtClaims: { subject: 'user-1', claims: { restaurantId: ['rest-1'] } } } as any
    let superUpdateSpy: any

    beforeEach(() => {
      // Espião no Pai: o filho valida a regra/histórico e delega a gravação ao CrudController.
      superUpdateSpy = vi.spyOn(CrudController.prototype, 'update')
        .mockResolvedValue({ payload: { success: true } } as any)
      mockRepository.appendHistory = vi.fn()
    })

    afterEach(() => {
      superUpdateSpy.mockRestore()
    })

    it('delega o update e grava o histórico do que mudou', async () => {
      mockRepository.findById.mockResolvedValue({ name: 'iFood', type: 'platform', status: 'active', feePercent: 12, settlementDays: 30 })

      await controller.update('id-1', { name: 'iFood Delivery', feePercent: 14 } as any, source)

      expect(superUpdateSpy).toHaveBeenCalled()
      expect(mockRepository.appendHistory).toHaveBeenCalledTimes(1)
      const entries = mockRepository.appendHistory.mock.calls[0][1]
      expect(entries.map((e: any) => e.action)).toEqual(['update-name', 'update-fee'])
      expect(entries.every((e: any) => e.by === 'user-1')).toBe(true)
    })

    it('PATCH que não muda nada não suja o histórico', async () => {
      mockRepository.findById.mockResolvedValue({ name: 'Caixa', type: 'cash', status: 'active' })

      await controller.update('id-1', { name: 'Caixa', status: 'active' } as any, source)

      expect(superUpdateSpy).toHaveBeenCalled()
      expect(mockRepository.appendHistory).not.toHaveBeenCalled()
    })

    it('se o update falhar na validação, nada é gravado no histórico', async () => {
      mockRepository.findById.mockResolvedValue({ name: 'Caixa', type: 'cash', status: 'active' })
      superUpdateSpy.mockRejectedValue(new Error('Validation failed'))

      await expect(controller.update('id-1', { name: 'Novo' } as any, source)).rejects.toThrow('Validation failed')

      expect(mockRepository.appendHistory).not.toHaveBeenCalled()
    })

    it('conta que não existe vira 404 antes de qualquer gravação', async () => {
      mockRepository.findById.mockResolvedValue(null)

      await expect(controller.update('id-1', { name: 'Novo' } as any, source)).rejects.toThrow()

      expect(superUpdateSpy).not.toHaveBeenCalled()
      expect(mockRepository.appendHistory).not.toHaveBeenCalled()
    })
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
