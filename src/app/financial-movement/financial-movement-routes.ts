import { FastifyInstance } from 'fastify'
import { FinancialMovementRepository } from './financial-movement-repository'
import { FinancialMovementController } from './financial-movement-controller'
import { RegisterMovementUseCase } from './use-cases/register-movement.use-case'

export async function financialMovementRoutes (fastify: FastifyInstance) {
  const repository = new FinancialMovementRepository()
  const registerUseCase = new RegisterMovementUseCase(repository)
  const controller = new FinancialMovementController(repository, registerUseCase)

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
}
