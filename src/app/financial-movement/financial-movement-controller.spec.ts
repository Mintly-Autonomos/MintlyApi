import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FinancialMovementController } from './financial-movement-controller'

describe('FinancialMovementController', () => {
  let controller: FinancialMovementController
  let repo: any
  let registerUseCase: any
  let changeStatusUseCase: any
  let updateUseCase: any
  let recomputeUseCase: any
  let reply: any

  const makeRequest = (over: Record<string, any> = {}) => ({
    headers: { env: 'test' },
    jwtClaims: { subject: 'u1', claims: { restaurantId: 'r1' } },
    body: {},
    params: {},
    query: {},
    ...over,
  })

  beforeEach(() => {
    repo = { findAll: vi.fn().mockResolvedValue([]) }
    registerUseCase = { execute: vi.fn().mockResolvedValue({ _id: 'm1' }) }
    changeStatusUseCase = { execute: vi.fn().mockResolvedValue({ _id: 'm1', status: 'settled' }) }
    updateUseCase = { execute: vi.fn().mockResolvedValue({ _id: 'm1' }) }
    recomputeUseCase = { execute: vi.fn().mockResolvedValue({ availableBalance: 0, predictedBalance: 0 }) }

    controller = new FinancialMovementController(
      repo as any,
      registerUseCase as any,
      changeStatusUseCase as any,
      updateUseCase as any,
      recomputeUseCase as any,
    )
    reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() }
  })

  it('register delega ao use case (body + ctx) e responde 201', async () => {
    await controller.register(makeRequest({ body: { title: 'X' } }), reply)

    expect(registerUseCase.execute).toHaveBeenCalledWith(
      { title: 'X' },
      expect.objectContaining({ restaurantId: 'r1' }),
    )
    expect(reply.status).toHaveBeenCalledWith(201)
    expect(reply.send).toHaveBeenCalled()
  })

  it('list delega ao repository e responde 200 com paginação', async () => {
    repo.findAll.mockResolvedValue([{ _id: 'a' }, { _id: 'b' }])
    await controller.list(makeRequest({ query: { size: '10' } }), reply)

    expect(repo.findAll).toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(200)
    const sent = reply.send.mock.calls[0][0]
    expect(sent.payload).toHaveLength(2)
    expect(sent.pagination.totalItems).toBe(2)
  })

  it('list sem query (undefined) usa filtro vazio e default de size 10', async () => {
    repo.findAll.mockResolvedValue([{ _id: 'a' }])
    await controller.list(makeRequest({ query: undefined }), reply)

    expect(repo.findAll).toHaveBeenCalledWith({}, expect.anything())
    expect(reply.status).toHaveBeenCalledWith(200)
    const sent = reply.send.mock.calls[0][0]
    // 1 item, size default 10 -> totalPages = ceil(1/10) = 1
    expect(sent.pagination.totalItems).toBe(1)
    expect(sent.pagination.totalPages).toBe(1)
  })

  it('changeStatus delega passando id e status', async () => {
    await controller.changeStatus(makeRequest({ params: { id: 'm1' }, body: { status: 'settled' } }), reply)

    expect(changeStatusUseCase.execute).toHaveBeenCalledWith('m1', 'settled', expect.anything())
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('update delega passando id e body', async () => {
    await controller.update(makeRequest({ params: { id: 'm1' }, body: { grossValue: 5 } }), reply)

    expect(updateUseCase.execute).toHaveBeenCalledWith('m1', { grossValue: 5 }, expect.anything())
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('recompute delega passando accountId', async () => {
    await controller.recompute(makeRequest({ body: { accountId: 'a1' } }), reply)

    expect(recomputeUseCase.execute).toHaveBeenCalledWith('a1', expect.anything())
    expect(reply.status).toHaveBeenCalledWith(200)
  })
})
