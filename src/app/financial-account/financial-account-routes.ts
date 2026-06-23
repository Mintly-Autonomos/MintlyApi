import { FastifyInstance } from 'fastify'
import { FinancialAccountRepository } from './financial-account-repository'
import { FinancialAccountController } from './financial-account-controller'

export async function financialAccountRoutes (fastify: FastifyInstance) {
  // 1. Injeção de Dependências na prática!
  // Criamos o banco, e entregamos ele para o Controller
  const repository = new FinancialAccountRepository()
  const controller = new FinancialAccountController(repository)

  // 2. Rota de Criação (POST /financial-accounts)
  fastify.post('/', async (request, reply) => {
    // O 'request' é o nosso 'source' (ele carrega o Header com o restaurantId)
    const response = await controller.insert(request.body as any, request)
    return reply.status(201).send(response)
  })

  // 3. Rota de Listagem e Busca (GET /financial-accounts?name=Caixa&status=active)
  fastify.get('/', async (request, reply) => {
    // Pegamos a busca e a paginação da URL (query)
    const response = await controller.findAll(request.query as any, request)
    return reply.status(200).send(response)
  })

  // 4. Rota de Atualização (PATCH /financial-accounts/:id)
  fastify.patch('/:id', async (request: any, reply) => {
    const { id } = request.params
    // O Controller vai barrar se tiver "isDefault" aqui dentro!
    const response = await controller.update(id, request.body as any, request)
    return reply.status(200).send(response)
  })

  // 5. Rota de Deleção (DELETE /financial-accounts/:id)
  // (Embora a task não cite deleção explicitamente, o CRUD genérico já nos dá isso de graça)
  fastify.delete('/:id', async (request: any, reply) => {
    const { id } = request.params
    await controller.delete(id, request)
    return reply.status(204).send()
  })

  fastify.patch('/:id/default', async (request: any, reply) => {
    return controller.setDefault(request, reply)
  })
}
