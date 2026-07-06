import { describe, it, expect, beforeEach, vi } from 'vitest'
import { financialAccountRoutes } from './financial-account-routes'

/**
 * Testes unitários — financialAccountRoutes
 *
 * Em vez de subir o servidor (auth + Mongo), registramos as rotas num Fastify
 * "de mentira" que captura os handlers, e exercitamos cada um deles isoladamente.
 * O controller (e suas dependências) é dublado — validamos que cada rota chama
 * o método certo do controller e responde com o status esperado.
 */

// --- Dublês das dependências instanciadas dentro de financialAccountRoutes ---
const h = vi.hoisted(() => ({
  insert: vi.fn(),
  findAll: vi.fn(),
  update: vi.fn(),
  setDefault: vi.fn(),
  inactivate: vi.fn(),
}))

vi.mock('./financial-account-controller', () => ({
  FinancialAccountController: class {
    insert = h.insert
    findAll = h.findAll
    update = h.update
    setDefault = h.setDefault
    inactivate = h.inactivate
  },
}))

vi.mock('./financial-account-repository', () => ({
  FinancialAccountRepository: class {},
}))

vi.mock('./use-cases/set-default-account.use-case', () => ({
  SetDefaultAccountUseCase: class {},
}))

vi.mock('./use-cases/inactivate-account.use-case', () => ({
  InactivateAccountUseCase: class {},
}))

// Fastify "de mentira": grava cada handler por "MÉTODO caminho".
function makeFakeFastify () {
  const routes: Record<string, (req: any, reply: any) => any> = {}
  return {
    routes,
    post: (path: string, handler: any) => { routes[`POST ${path}`] = handler },
    get: (path: string, handler: any) => { routes[`GET ${path}`] = handler },
    patch: (path: string, handler: any) => { routes[`PATCH ${path}`] = handler },
  }
}

function makeReply () {
  return { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnValue('sent') }
}

describe('financialAccountRoutes', () => {
  let fastify: ReturnType<typeof makeFakeFastify>

  beforeEach(async () => {
    vi.clearAllMocks()
    fastify = makeFakeFastify()
    await financialAccountRoutes(fastify as any)
  })

  it('registra todas as rotas esperadas', () => {
    expect(Object.keys(fastify.routes).sort()).toEqual([
      'GET /',
      'PATCH /:id',
      'PATCH /:id/default',
      'PATCH /:id/inactivate',
      'POST /',
    ])
  })

  it('POST / cria a conta e responde 201', async () => {
    h.insert.mockResolvedValue({ payload: { id: 'acc-1' } })
    const request = { body: { name: 'Caixa' } }
    const reply = makeReply()

    await fastify.routes['POST /'](request, reply)

    expect(h.insert).toHaveBeenCalledWith({ name: 'Caixa' }, request)
    expect(reply.status).toHaveBeenCalledWith(201)
    expect(reply.send).toHaveBeenCalledWith({ payload: { id: 'acc-1' } })
  })

  it('GET / lista as contas e responde 200', async () => {
    h.findAll.mockResolvedValue({ payload: [] })
    const request = { query: { name: 'Caixa', status: 'active' } }
    const reply = makeReply()

    await fastify.routes['GET /'](request, reply)

    expect(h.findAll).toHaveBeenCalledWith({ name: 'Caixa', status: 'active' }, request)
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('PATCH /:id atualiza a conta e responde 200', async () => {
    h.update.mockResolvedValue({ payload: { id: 'acc-1' } })
    const request = { params: { id: 'acc-1' }, body: { name: 'Novo' } }
    const reply = makeReply()

    await fastify.routes['PATCH /:id'](request, reply)

    expect(h.update).toHaveBeenCalledWith('acc-1', { name: 'Novo' }, request)
    expect(reply.status).toHaveBeenCalledWith(200)
  })

  it('PATCH /:id/default delega para controller.setDefault(request, reply)', async () => {
    h.setDefault.mockResolvedValue('setDefault-result')
    const request = { params: { id: 'acc-1' } }
    const reply = makeReply()

    const result = await fastify.routes['PATCH /:id/default'](request, reply)

    expect(h.setDefault).toHaveBeenCalledWith(request, reply)
    expect(result).toBe('setDefault-result')
  })

  it('PATCH /:id/inactivate delega para controller.inactivate(request, reply)', async () => {
    h.inactivate.mockResolvedValue('inactivate-result')
    const request = { params: { id: 'acc-1' }, body: { replacementDefaultId: 'acc-2' } }
    const reply = makeReply()

    const result = await fastify.routes['PATCH /:id/inactivate'](request, reply)

    expect(h.inactivate).toHaveBeenCalledWith(request, reply)
    expect(result).toBe('inactivate-result')
  })
})
