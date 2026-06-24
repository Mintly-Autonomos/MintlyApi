import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InactivateAccountUseCase } from './inactivate-account.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import type { RequestContext } from '../../../core/context/request-context'

/**
 * Testes unitários — MIN-65: InactivateAccountUseCase
 *
 * Guards (409 ConflictError):
 *  - saldo disponível diferente de zero
 *  - saldo previsto diferente de zero
 *  - é a única conta ativa do restaurante
 *  - é a padrão e nenhuma substituta foi informada
 *
 * Mais: validação da substituta, swap transacional na ordem segura
 * (inativa o alvo antes de promover a substituta), idempotência e isolamento por tenant.
 */

// --- Mocks "hoisted" (mesmo padrão de set-default-account.use-case.spec.ts) ---
const h = vi.hoisted(() => {
  const withTransaction = vi.fn(async (cb: () => Promise<unknown>) => cb())
  const endSession = vi.fn()
  return {
    find: vi.fn(),
    update: vi.fn(),
    withTransaction,
    endSession,
    // Referência ESTÁVEL da sessão — é o objeto repassado ao repo em { session }.
    session: { withTransaction, endSession },
  }
})

vi.mock('../financial-account-repository', () => ({
  FinancialAccountRepository: class {
    find = h.find
    update = h.update
  },
}))

vi.mock('../../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: vi.fn(() => ({
      getClient: vi.fn(() => ({
        startSession: vi.fn(() => h.session),
      })),
    })),
  },
}))

// --- Fixtures ---
const CTX: RequestContext = { env: 'test', userId: 'user-1', restaurantId: 'rest-1' }

const ACTIVE_ACCOUNT = {
  _id: 'acc-1',
  name: 'Caixa',
  type: 'cash',
  status: 'active',
  isDefault: false,
  restaurantId: 'rest-1',
  availableBalance: 0,
  predictedBalance: 0,
  history: [],
}

const OTHER_ACTIVE = { ...ACTIVE_ACCOUNT, _id: 'acc-2', name: 'Banco' }
const DEFAULT_TARGET = { ...ACTIVE_ACCOUNT, isDefault: true }
const REPLACEMENT = { ...ACTIVE_ACCOUNT, _id: 'acc-2', name: 'Banco', status: 'active' }

describe('InactivateAccountUseCase (MIN-65)', () => {
  let sut: InactivateAccountUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    h.withTransaction.mockImplementation(async (cb: () => Promise<unknown>) => cb())
    h.update.mockResolvedValue(undefined)
    sut = new InactivateAccountUseCase()
  })

  describe('fluxo de sucesso', () => {
    it('isola as buscas por restaurantId — multi-tenant', async () => {
      // Arrange
      h.find.mockResolvedValueOnce(ACTIVE_ACCOUNT).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act
      await sut.execute('acc-1', CTX)

      // Assert — 1ª busca: a conta-alvo isolada pelo tenant
      expect(h.find).toHaveBeenNthCalledWith(
        1,
        { _id: 'acc-1', restaurantId: 'rest-1' },
        CTX,
        { session: h.session },
      )
      // 2ª busca: outra conta ativa do MESMO restaurante, excluindo a própria pelo _id real
      expect(h.find).toHaveBeenNthCalledWith(
        2,
        { status: 'active', restaurantId: 'rest-1', _id: { $ne: 'acc-1' } },
        CTX,
        { session: h.session },
      )
    })

    it('inativa uma conta não-padrão com um único update', async () => {
      // Arrange
      h.find.mockResolvedValueOnce(ACTIVE_ACCOUNT).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act
      await sut.execute('acc-1', CTX)

      // Assert
      expect(h.update).toHaveBeenCalledTimes(1)
      const [id, payload, ctx, opts] = h.update.mock.calls[0]
      expect(id === 'acc-1').toBe(true)
      expect(payload.status === 'inactive').toBe(true)
      expect(payload.isDefault === false).toBe(true)
      expect(ctx).toBe(CTX)
      expect(opts).toEqual({ session: h.session })
    })

    it('registra entrada de auditoria "inactivate" no history da conta-alvo', async () => {
      // Arrange
      h.find.mockResolvedValueOnce(ACTIVE_ACCOUNT).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act
      await sut.execute('acc-1', CTX)

      // Assert
      const [, payload] = h.update.mock.calls[0]
      expect(payload.history).toHaveLength(1)
      expect(payload.history[0]).toMatchObject({ by: 'user-1', action: 'inactivate' })
      expect(typeof payload.history[0].at === 'string').toBe(true) // string ISO (decisão de equipe)
    })

    it('usa \'system\' como autor quando ctx.userId está ausente', async () => {
      // Arrange
      const CTX_NO_USER: RequestContext = { env: 'test', restaurantId: 'rest-1' }
      h.find.mockResolvedValueOnce(ACTIVE_ACCOUNT).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act
      await sut.execute('acc-1', CTX_NO_USER)

      // Assert
      const [, payload] = h.update.mock.calls[0]
      const last = payload.history[payload.history.length - 1]
      expect(last.by === 'system').toBe(true)
    })

    it('é idempotente: conta já inativa não busca a outra ativa nem escreve nada', async () => {
      // Arrange
      h.find.mockResolvedValueOnce({ ...ACTIVE_ACCOUNT, status: 'inactive' })

      // Act
      await sut.execute('acc-1', CTX)

      // Assert
      expect(h.find).toHaveBeenCalledTimes(1)
      expect(h.update).not.toHaveBeenCalled()
    })
  })

  describe('inativação de conta padrão (com substituta)', () => {
    it('faz o swap: inativa a padrão ANTES de promover a substituta', async () => {
      // Arrange
      h.find
        .mockResolvedValueOnce(DEFAULT_TARGET)
        .mockResolvedValueOnce(OTHER_ACTIVE)
        .mockResolvedValueOnce(REPLACEMENT)

      // Act
      await sut.execute('acc-1', CTX, 'acc-2')

      // Assert — dois updates
      expect(h.update).toHaveBeenCalledTimes(2)

      // 1º: a conta-alvo é inativada e perde o default
      const [tId, tPayload] = h.update.mock.calls[0]
      expect(tId === 'acc-1').toBe(true)
      expect(tPayload.status === 'inactive').toBe(true)
      expect(tPayload.isDefault === false).toBe(true)

      // 2º: a substituta assume o default
      const [rId, rPayload] = h.update.mock.calls[1]
      expect(rId === 'acc-2').toBe(true)
      expect(rPayload.isDefault === true).toBe(true)

      // Ordem importa: remover o default do alvo antes de criar o novo
      // (índice unique parcial {restaurantId} where isDefault:true)
      expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(
        h.update.mock.invocationCallOrder[1],
      )
    })

    it('registra "set-default" no history da substituta', async () => {
      // Arrange
      h.find
        .mockResolvedValueOnce(DEFAULT_TARGET)
        .mockResolvedValueOnce(OTHER_ACTIVE)
        .mockResolvedValueOnce(REPLACEMENT)

      // Act
      await sut.execute('acc-1', CTX, 'acc-2')

      // Assert
      const [, rPayload] = h.update.mock.calls[1]
      const last = rPayload.history[rPayload.history.length - 1]
      expect(last).toMatchObject({ by: 'user-1', action: 'set-default' })
    })
  })

  describe('guards (regras de bloqueio)', () => {
    it('bloqueia com ConflictError quando availableBalance ≠ 0', async () => {
      // Arrange
      h.find.mockResolvedValueOnce({ ...ACTIVE_ACCOUNT, availableBalance: 10 })

      // Act + Assert
      await expect(sut.execute('acc-1', CTX)).rejects.toBeInstanceOf(ConflictError)
      expect(h.find).toHaveBeenCalledTimes(1) // nem busca a outra ativa
      expect(h.update).not.toHaveBeenCalled()
    })

    it('bloqueia com ConflictError quando predictedBalance ≠ 0', async () => {
      // Arrange
      h.find.mockResolvedValueOnce({ ...ACTIVE_ACCOUNT, predictedBalance: 5 })

      // Act + Assert
      await expect(sut.execute('acc-1', CTX)).rejects.toBeInstanceOf(ConflictError)
      expect(h.update).not.toHaveBeenCalled()
    })

    it('bloqueia com ConflictError quando é a única conta ativa', async () => {
      // Arrange — não existe outra conta ativa
      h.find.mockResolvedValueOnce(ACTIVE_ACCOUNT).mockResolvedValueOnce(null)

      // Act + Assert
      await expect(sut.execute('acc-1', CTX)).rejects.toBeInstanceOf(ConflictError)
      expect(h.find).toHaveBeenCalledTimes(2)
      expect(h.update).not.toHaveBeenCalled()
    })

    it('bloqueia com ConflictError quando é a padrão e não há substituta informada', async () => {
      // Arrange — conta-alvo é padrão; existe outra ativa; mas nenhum replacementDefaultId
      h.find.mockResolvedValueOnce(DEFAULT_TARGET).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act + Assert
      await expect(sut.execute('acc-1', CTX)).rejects.toBeInstanceOf(ConflictError)
      expect(h.find).toHaveBeenCalledTimes(2) // não chega a buscar a substituta
      expect(h.update).not.toHaveBeenCalled()
    })

    it('bloqueia com ConflictError quando a substituta é a própria conta sendo inativada', async () => {
      // Arrange
      h.find.mockResolvedValueOnce(DEFAULT_TARGET).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act + Assert
      await expect(sut.execute('acc-1', CTX, 'acc-1')).rejects.toBeInstanceOf(ConflictError)
      expect(h.find).toHaveBeenCalledTimes(2)
      expect(h.update).not.toHaveBeenCalled()
    })

    it('lança NotFoundError quando a substituta informada não existe', async () => {
      // Arrange
      h.find
        .mockResolvedValueOnce(DEFAULT_TARGET)
        .mockResolvedValueOnce(OTHER_ACTIVE)
        .mockResolvedValueOnce(null)

      // Act + Assert
      await expect(sut.execute('acc-1', CTX, 'acc-x')).rejects.toBeInstanceOf(NotFoundError)
      expect(h.find).toHaveBeenCalledTimes(3)
      expect(h.update).not.toHaveBeenCalled()
    })

    it('bloqueia com ConflictError quando a substituta não está ativa', async () => {
      // Arrange
      h.find
        .mockResolvedValueOnce(DEFAULT_TARGET)
        .mockResolvedValueOnce(OTHER_ACTIVE)
        .mockResolvedValueOnce({ ...REPLACEMENT, status: 'inactive' })

      // Act + Assert
      await expect(sut.execute('acc-1', CTX, 'acc-2')).rejects.toBeInstanceOf(ConflictError)
      expect(h.find).toHaveBeenCalledTimes(3)
      expect(h.update).not.toHaveBeenCalled()
    })

    it('lança NotFoundError quando a conta-alvo não existe', async () => {
      // Arrange
      h.find.mockResolvedValueOnce(null)

      // Act + Assert
      await expect(sut.execute('missing', CTX)).rejects.toBeInstanceOf(NotFoundError)
      expect(h.find).toHaveBeenCalledTimes(1)
      expect(h.update).not.toHaveBeenCalled()
    })
  })

  describe('transação / sessão', () => {
    it('executa dentro de uma transação e encerra a sessão', async () => {
      // Arrange
      h.find.mockResolvedValueOnce(ACTIVE_ACCOUNT).mockResolvedValueOnce(OTHER_ACTIVE)

      // Act
      await sut.execute('acc-1', CTX)

      // Assert
      expect(h.withTransaction).toHaveBeenCalledTimes(1)
      expect(h.endSession).toHaveBeenCalledTimes(1)
    })

    it('encerra a sessão mesmo quando a operação falha (finally)', async () => {
      // Arrange — força NotFoundError dentro da transação
      h.find.mockResolvedValueOnce(null)

      // Act + Assert
      await expect(sut.execute('missing', CTX)).rejects.toBeInstanceOf(NotFoundError)
      expect(h.endSession).toHaveBeenCalledTimes(1)
    })
  })
})
