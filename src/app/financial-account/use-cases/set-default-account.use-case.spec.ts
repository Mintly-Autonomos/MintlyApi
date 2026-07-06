import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SetDefaultAccountUseCase } from './set-default-account.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import type { RequestContext } from '../../../core/context/request-context'

/**
 * Testes unitários — SetDefaultAccountUseCase (MIN-65)
 *
 * Cobre os branches do swap transacional:
 *  - conta-alvo inexistente -> NotFoundError
 *  - conta-alvo já é padrão -> idempotente (não escreve)
 *  - conta-alvo inativa -> ConflictError
 *  - existe padrão anterior DIFERENTE -> rebaixa + promove (2 updates)
 *  - existe "padrão" com o MESMO _id da alvo -> só promove (1 update)
 *  - NÃO existe padrão anterior -> só promove (1 update)
 *  - history não-array na padrão anterior -> inicializa vazio
 *  - autor 'system' quando ctx.userId ausente
 *  - transação/sessão (withTransaction + endSession, inclusive no finally)
 */

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
  history: [{ at: new Date('2026-01-01T00:00:00.000Z'), by: 'old-user', action: 'set-default' }],
}

describe('SetDefaultAccountUseCase (MIN-65) — unitário', () => {
  let sut: SetDefaultAccountUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    h.withTransaction.mockImplementation(async (cb: () => Promise<unknown>) => cb())
    h.update.mockResolvedValue(undefined)
    sut = new SetDefaultAccountUseCase()
  })

  it('isola as buscas por restaurantId — multi-tenant', async () => {
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(CURRENT_DEFAULT)

    await sut.execute('acc-target', CTX)

    expect(h.find).toHaveBeenNthCalledWith(
      1,
      { _id: 'acc-target', restaurantId: 'rest-1' },
      CTX,
      { session: h.session },
    )
    expect(h.find).toHaveBeenNthCalledWith(
      2,
      { isDefault: true, restaurantId: 'rest-1' },
      CTX,
      { session: h.session },
    )
  })

  it('faz o swap: rebaixa a padrão anterior ANTES de promover a nova', async () => {
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(CURRENT_DEFAULT)

    await sut.execute('acc-target', CTX)

    expect(h.update).toHaveBeenCalledTimes(2)

    const [oldId, oldPayload] = h.update.mock.calls[0]
    expect(oldId === 'acc-old-default').toBe(true)
    expect(oldPayload.isDefault === false).toBe(true)
    // history preservado + entrada 'unset-default'
    expect(oldPayload.history).toHaveLength(2)
    expect(oldPayload.history[1]).toMatchObject({ by: 'user-1', action: 'unset-default' })

    const [newId, newPayload] = h.update.mock.calls[1]
    expect(newId === 'acc-target').toBe(true)
    expect(newPayload.isDefault === true).toBe(true)
    expect(newPayload.history[newPayload.history.length - 1]).toMatchObject({ by: 'user-1', action: 'set-default' })

    expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(
      h.update.mock.invocationCallOrder[1],
    )
  })

  it('inicializa history vazio quando a padrão anterior não tem history array', async () => {
    h.find
      .mockResolvedValueOnce(TARGET_ACCOUNT)
      .mockResolvedValueOnce({ ...CURRENT_DEFAULT, history: undefined })

    await sut.execute('acc-target', CTX)

    const [, oldPayload] = h.update.mock.calls[0]
    expect(oldPayload.history).toHaveLength(1)
    expect(oldPayload.history[0]).toMatchObject({ action: 'unset-default' })
  })

  it('não rebaixa quando a "padrão atual" retornada é a própria conta-alvo (mesmo _id)', async () => {
    // Cenário de borda: alvo não-padrão, mas a query de padrão devolve o mesmo _id.
    // O branch String(currentDefault._id) !== id é FALSO -> sem rebaixamento.
    h.find
      .mockResolvedValueOnce(TARGET_ACCOUNT)
      .mockResolvedValueOnce({ ...CURRENT_DEFAULT, _id: 'acc-target' })

    await sut.execute('acc-target', CTX)

    expect(h.update).toHaveBeenCalledTimes(1)
    const [id, payload] = h.update.mock.calls[0]
    expect(id === 'acc-target').toBe(true)
    expect(payload.isDefault === true).toBe(true)
  })

  it('apenas promove a nova conta quando NÃO existe padrão anterior', async () => {
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(null)

    await sut.execute('acc-target', CTX)

    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledWith(
      'acc-target',
      expect.objectContaining({ isDefault: true }),
      CTX,
      { session: h.session },
    )
  })

  it('inicializa history vazio quando a conta-alvo não tem history array', async () => {
    // alvo sem history (undefined) e sem padrão anterior -> um único update
    h.find
      .mockResolvedValueOnce({ ...TARGET_ACCOUNT, history: undefined })
      .mockResolvedValueOnce(null)

    await sut.execute('acc-target', CTX)

    const [, payload] = h.update.mock.calls[0]
    expect(payload.history).toHaveLength(1)
    expect(payload.history[0]).toMatchObject({ action: 'set-default' })
  })

  it('usa \'system\' como autor quando ctx.userId está ausente', async () => {
    const CTX_NO_USER: RequestContext = { env: 'test', restaurantId: 'rest-1' }
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(null)

    await sut.execute('acc-target', CTX_NO_USER)

    const [, payload] = h.update.mock.calls[0]
    const last = payload.history[payload.history.length - 1]
    expect(last).toMatchObject({ by: 'system', action: 'set-default' })
  })

  it('é idempotente: alvo já é a padrão -> não busca a padrão atual nem escreve', async () => {
    h.find.mockResolvedValueOnce({ ...TARGET_ACCOUNT, isDefault: true })

    await sut.execute('acc-target', CTX)

    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('bloqueia com ConflictError ao definir conta inativa como padrão', async () => {
    h.find.mockResolvedValueOnce({ ...TARGET_ACCOUNT, status: 'inactive' })

    await expect(sut.execute('acc-target', CTX)).rejects.toBeInstanceOf(ConflictError)
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('lança NotFoundError quando a conta-alvo não existe', async () => {
    h.find.mockResolvedValueOnce(null)

    await expect(sut.execute('inexistente', CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('executa dentro de uma transação e encerra a sessão', async () => {
    h.find.mockResolvedValueOnce(TARGET_ACCOUNT).mockResolvedValueOnce(null)

    await sut.execute('acc-target', CTX)

    expect(h.withTransaction).toHaveBeenCalledTimes(1)
    expect(h.endSession).toHaveBeenCalledTimes(1)
  })

  it('encerra a sessão mesmo quando a transação falha (finally)', async () => {
    h.find.mockResolvedValueOnce(null)

    await expect(sut.execute('inexistente', CTX)).rejects.toBeInstanceOf(NotFoundError)
    expect(h.endSession).toHaveBeenCalledTimes(1)
  })
})
