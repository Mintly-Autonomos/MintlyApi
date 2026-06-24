import { FastifyInstance } from 'fastify'
import { FinancialAccountRepository } from './financial-account-repository'
import { FinancialAccountController } from './financial-account-controller'
import { SetDefaultAccountUseCase } from './use-cases/set-default-account.use-case'
import { InactivateAccountUseCase } from './use-cases/inactivate-account.use-case'

export async function financialAccountRoutes (fastify: FastifyInstance) {
  // Injeção de Dependências: criamos repo + use cases e entregamos ao controller.
  const repository = new FinancialAccountRepository()
  const setDefaultUseCase = new SetDefaultAccountUseCase(repository)
  const inactivateUseCase = new InactivateAccountUseCase(repository)
  const controller = new FinancialAccountController(repository, setDefaultUseCase, inactivateUseCase)

  // POST /financial-accounts
  fastify.post('/', async (request, reply) => {
    const response = await controller.insert(request.body as any, request)
    return reply.status(201).send(response)
  })

  // GET /financial-accounts?name=Caixa&status=active
  fastify.get('/', async (request, reply) => {
    const response = await controller.findAll(request.query as any, request)
    return reply.status(200).send(response)
  })

  // PATCH /financial-accounts/:id  (edição parcial: name, type, feePercent, settlementDays)
  fastify.patch('/:id', async (request: any, reply) => {
    const { id } = request.params
    const response = await controller.update(id, request.body as any, request)
    return reply.status(200).send(response)
  })

  // PATCH /financial-accounts/:id/default  (define conta padrão via use case transacional)
  fastify.patch('/:id/default', async (request: any, reply) => {
    return controller.setDefault(request, reply)
  })

  // PATCH /financial-accounts/:id/inactivate  (inativação com guards via use case transacional)
  // body opcional: { replacementDefaultId?: string }
  // -> obrigatório quando a conta-alvo for a padrão (assume o lugar dela).
  fastify.patch('/:id/inactivate', async (request: any, reply) => {
    return controller.inactivate(request, reply)
  })

  // NOTA: a rota DELETE /:id foi REMOVIDA de propósito.
  // A história fala em INATIVAÇÃO (soft delete com guards de saldo/única-ativa/padrão
  // e preservação do history[] para auditoria), não em deleção física. O delete da base
  // (deleteOne) apagava o documento driblando todos os guards e destruindo a auditoria.
  // "Desativar" uma conta é só via /:id/inactivate.
}
