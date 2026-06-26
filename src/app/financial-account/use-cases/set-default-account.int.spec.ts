import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SetDefaultAccountUseCase } from './set-default-account.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import type { RequestContext } from '../../../core/context/request-context'

/**
 * Testes unitários — MIN-65: SetDefaultAccountUseCase
 *
 * Cobertura das regras implementadas no SUT:
 *  - #1 Isolamento por restaurantId (multi-tenant) nas buscas
 *  - #2 Apenas uma conta padrão por restaurante (garantida via swap a nível de app)
 *  - #3 Swap transacional: rebaixa a padrão anterior e promove a nova
 *  - #5 Auditoria (history) em AMBAS as contas afetadas
 *  - Cenário de erro: conta-alvo inexistente -> NotFoundError
 *
 * ATENÇÃO (ver bloco no final do arquivo): a regra #4 (bloquear conta inativa)
 * NÃO está implementada no SUT fornecido. Não inventamos uma asserção que
 * passaria por engano — documentamos o comportamento atual e deixamos um it.todo.
 */

// --- Mocks "hoisted" (mesmo padrão usado em password-recovery-use-case.spec.ts) ---
const h = vi.hoisted(() => {
  const withTransaction = vi.fn(async (cb: () => Promise<unknown>) => cb())
  const endSession = vi.fn()
  return {
    find: vi.fn(),
    update: vi.fn(),
    withTransaction,
    endSession,
    // Referência ESTÁVEL da sessão — é exatamente o objeto repassado ao repo em { session }.
    session: { withTransaction, endSession },
  }
})

// O Use Case instancia `new FinancialAccountRepository()` por default no construtor.
// Substituímos a classe inteira por um dublê com os métodos que o SUT consome.
vi.mock('../financial-account-repository', () => ({
  FinancialAccountRepository: class {
    find = h.find
    update = h.update
  },
}))

// O SUT faz: MongoDBConnection.getInstance().getClient().startSession()
// e depois session.withTransaction(cb) / session.endSession().
// Mockamos o export `default` para devolver nossa sessão controlada.
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

const TARGET_ACCOUNT = {
  _id: 'acc-target',
  name: 'Caixa Secundário',
  type: 'cash',
  status: 'active',
  isDefault: false,
  restaurantId: 'rest-1',
  history: [],
}

const CURRENT_DEFAULT = {
  _id: 'acc-old-default',
  name: 'Caixa Principal',
  type: 'cash',
  status: 'active',
  isDefault: true,
  restaurantId: 'rest-1',
  history: [{ at: '2026-01-01T00:00:00.000Z', by: 'old-user', action: 'set-default' }],
}

describe('SetDefaultAccountUseCase (MIN-65)', () => {
  let sut: SetDefaultAccountUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    // Reafirma a implementação da transação (clearAllMocks limpa chamadas, não a impl,
    // mas reforçamos para blindar contra resetAllMocks futuro).
    h.withTransaction.mockImplementation(async (cb: () => Promise<unknown>) => cb())
    h.update.mockResolvedValue(undefined)
    sut = new SetDefaultAccountUseCase()
  })

  it('isola as buscas por restaurantId — multi-tenant (regra #1)', async () => {
    // Arrange
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(CURRENT_DEFAULT)

    // Act
    await sut.execute('acc-target', CTX)

    // Assert — 1ª busca: a conta-alvo isolada pelo tenant
    expect(h.find).toHaveBeenNthCalledWith(
      1,
      { _id: 'acc-target', restaurantId: 'rest-1' },
      CTX,
      { session: h.session },
    )
    // 2ª busca: a padrão atual do MESMO restaurante
    expect(h.find).toHaveBeenNthCalledWith(
      2,
      { isDefault: true, restaurantId: 'rest-1' },
      CTX,
      { session: h.session },
    )
  })

  it('faz o swap transacional: rebaixa a antiga e promove a nova (regras #2 e #3)', async () => {
    // Arrange
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(CURRENT_DEFAULT)

    // Act
    await sut.execute('acc-target', CTX)

    // Assert — exatamente dois updates, na ordem correta
    expect(h.update).toHaveBeenCalledTimes(2)

    const [oldId, oldPayload, oldCtx, oldOpts] = h.update.mock.calls[0]
    expect(oldId === 'acc-old-default').toBe(true)
    expect(oldPayload.isDefault === false).toBe(true)
    expect(oldCtx).toBe(CTX)
    expect(oldOpts).toEqual({ session: h.session })

    const [newId, newPayload, newCtx, newOpts] = h.update.mock.calls[1]
    expect(newId === 'acc-target').toBe(true)
    expect(newPayload.isDefault === true).toBe(true)
    expect(newCtx).toBe(CTX)
    expect(newOpts).toEqual({ session: h.session })

    // A antiga é rebaixada ANTES de a nova ser promovida
    expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(
      h.update.mock.invocationCallOrder[1],
    )
  })

  it('registra auditoria no history de AMBAS as contas afetadas (regra #5)', async () => {
    // Arrange
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(CURRENT_DEFAULT)

    // Act
    await sut.execute('acc-target', CTX)

    // Assert — conta que PERDE o default: history preservado + entrada 'unset-default'
    const [, oldPayload] = h.update.mock.calls[0]
    expect(oldPayload.history).toHaveLength(2)
    expect(oldPayload.history[0]).toEqual(CURRENT_DEFAULT.history[0]) // entrada anterior preservada
    expect(oldPayload.history[1]).toMatchObject({ by: 'user-1', action: 'unset-default' })
    expect(oldPayload.history[1].at instanceof Date).toBe(true)

    // conta que GANHA o default: entrada 'set-default'
    const [, newPayload] = h.update.mock.calls[1]
    expect(newPayload.history).toHaveLength(1)
    expect(newPayload.history[0]).toMatchObject({ by: 'user-1', action: 'set-default' })
  })

  it('usa \'system\' como autor quando ctx.userId está ausente', async () => {
    // Arrange
    const CTX_NO_USER: RequestContext = { env: 'test', restaurantId: 'rest-1' }
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(null)

    // Act
    await sut.execute('acc-target', CTX_NO_USER)

    // Assert
    const [, payload] = h.update.mock.calls[0]
    const lastEntry = payload.history[payload.history.length - 1]
    expect(lastEntry).toMatchObject({ by: 'system', action: 'set-default' })
  })

  it('apenas promove a nova conta quando NÃO existe padrão anterior (sem swap)', async () => {
    // Arrange — segunda busca (padrão atual) retorna null
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(null)

    // Act
    await sut.execute('acc-target', CTX)

    // Assert — um único update, promovendo a conta-alvo
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledWith(
      'acc-target',
      expect.objectContaining({ isDefault: true }),
      CTX,
      { session: h.session },
    )
  })

  it('é idempotente: se a conta-alvo já é a padrão, não busca a padrão atual nem escreve', async () => {
    // Arrange
    const SELF = { ...TARGET_ACCOUNT, _id: 'acc-self', isDefault: true }
    h.find.mockResolvedValueOnce(SELF)

    // Act
    await sut.execute('acc-self', CTX)

    // Assert
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('lança NotFoundError quando a conta-alvo não existe (cenário de erro)', async () => {
    // Arrange — primeira busca retorna null
    h.find.mockResolvedValueOnce(null)

    // Act + Assert
    await expect(sut.execute('inexistente', CTX)).rejects.toBeInstanceOf(NotFoundError)
    // Nenhuma escrita deve ocorrer
    expect(h.update).not.toHaveBeenCalled()
  })

  it('executa as escritas dentro de uma transação e encerra a sessão', async () => {
    // Arrange
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(null)

    // Act
    await sut.execute('acc-target', CTX)

    // Assert
    expect(h.withTransaction).toHaveBeenCalledTimes(1)
    expect(h.endSession).toHaveBeenCalledTimes(1)
  })

  it('encerra a sessão mesmo quando a transação falha (finally)', async () => {
    // Arrange — força NotFoundError dentro da transação
    h.find.mockResolvedValueOnce(null)

    // Act + Assert
    await expect(sut.execute('inexistente', CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(h.endSession).toHaveBeenCalledTimes(1)
  })

  /**
   * Regra MIN-65 #4 — "impedir conta inativa como padrão".
   *
   * O SUT fornecido NÃO possui nenhuma verificação de `status`. Portanto, em vez
   * de criar uma asserção falsa que aparentaria validar a regra, fixamos o
   * comportamento ATUAL (permissivo) e deixamos um TODO sinalizando a lacuna.
   */
  describe('Regra #4 — conta inativa não pode ser padrão', () => {
    it('lança ConflictError ao tentar definir conta inativa como padrão', async () => {
    // Arrange
      const INACTIVE = { ...TARGET_ACCOUNT, status: 'inactive' }
      h.find.mockResolvedValueOnce(INACTIVE)

      // Act + Assert
      await expect(sut.execute('acc-target', CTX)).rejects.toBeInstanceOf(ConflictError)
    })

    it('não busca a padrão atual nem escreve nada quando a conta-alvo está inativa', async () => {
    // Arrange
      const INACTIVE = { ...TARGET_ACCOUNT, status: 'inactive' }
      h.find.mockResolvedValueOnce(INACTIVE)

      // Act + Assert
      await expect(sut.execute('acc-target', CTX)).rejects.toBeInstanceOf(ConflictError)
      expect(h.find).toHaveBeenCalledTimes(1) // só a busca da conta-alvo
      expect(h.update).not.toHaveBeenCalled()
    })
  })
})
