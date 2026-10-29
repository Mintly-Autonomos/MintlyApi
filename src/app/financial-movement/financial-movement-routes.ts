import { FastifyInstance } from 'fastify'
import { FinancialMovementRepository } from './financial-movement-repository'
import { FinancialMovementController } from './financial-movement-controller'
import { RegisterMovementUseCase } from './use-cases/register-movement.use-case'
import { ChangeMovementStatusUseCase } from './use-cases/change-movement-status.use-case'
import { UpdateMovementUseCase } from './use-cases/update-movement.use-case'
import { RecomputeBalancesUseCase } from './use-cases/recompute-balances.use-case'
import { ImportMovementsUseCase } from './use-cases/import-movements.use-case'

export async function financialMovementRoutes (fastify: FastifyInstance) {
  const repository = new FinancialMovementRepository()
  const registerUseCase = new RegisterMovementUseCase(repository)
  const controller = new FinancialMovementController(
    repository,
    registerUseCase,
    new ChangeMovementStatusUseCase(),
    new UpdateMovementUseCase(),
    new RecomputeBalancesUseCase(),
    new ImportMovementsUseCase(registerUseCase),
  )

  // POST /financial-movements/import — importação em massa (até 500 linhas), idempotente.
  // body: { idempotencyKey, rows: [{ row, ...campos do POST / }] }
  // 201 { replayed:false, total, created, failed, results[] }; reenvio da mesma chave -> 200 replayed:true.
  // Linha inválida/duplicada vira `failed` no resultado; não derruba as outras.
  fastify.post('/import', { bodyLimit: 2 * 1024 * 1024 }, async (request: any, reply) => {
    return controller.importBatch(request, reply)
  })

  // POST /financial-movements — registra entrada/saída + ajusta saldo (transacional).
  // body: { direction, title, grossValue, date, accountId, categoryId, paymentMethod,
  //         status?, counterparty?, fiscalNote?, description?, origin?, confirmDuplicate? }
  fastify.post('/', async (request: any, reply) => {
    return controller.register(request, reply)
  })

  // GET /financial-movements?q=&direction=&status=&dateFrom=&dateTo=&page=&size=
  fastify.get('/', async (request: any, reply) => {
    return controller.list(request, reply)
  })

  // POST /financial-movements/recompute-balances — reconcilia o saldo da conta.
  // body: { accountId }
  fastify.post('/recompute-balances', async (request: any, reply) => {
    return controller.recompute(request, reply)
  })

  // PATCH /financial-movements/:id/status — muda status (corrige saldo). body: { status, settledAt? }
  fastify.patch('/:id/status', async (request: any, reply) => {
    return controller.changeStatus(request, reply)
  })

  // PATCH /financial-movements/:id — edição (reverte+aplica saldo).
  fastify.patch('/:id', async (request: any, reply) => {
    return controller.update(request, reply)
  })
}
