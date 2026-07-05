import { FastifyInstance } from 'fastify'
import { FinancialCategoryRepository } from './financial-category-repository'
import { FinancialCategoryController } from './financial-category-controller'
import { InactivateCategoryUseCase } from './use-cases/inactivate-category.use-case'
import { SuggestCategoriesQuery } from './use-cases/suggest-categories.query'

export async function financialCategoryRoutes (fastify: FastifyInstance) {
  const repository = new FinancialCategoryRepository()
  const inactivateUseCase = new InactivateCategoryUseCase(repository)
  const suggestQuery = new SuggestCategoriesQuery(repository)
  const controller = new FinancialCategoryController(repository, inactivateUseCase, suggestQuery)

  fastify.post('/', async (request, reply) => {
    const response = await controller.insert(request.body as any, request)
    return reply.status(201).send(response)
  })

  fastify.get('/', async (request, reply) => {
    const response = await controller.findAll(request.query as any, request)
    return reply.status(200).send(response)
  })

  // Rota estática registrada antes de "/:id" por clareza de leitura — o router
  // do Fastify (find-my-way) já resolve estático antes de parametrizado de
  // qualquer forma, mas a ordem no arquivo documenta a intenção.
  fastify.get('/suggestions', async (request, reply) => {
    return controller.suggestions(request, reply)
  })

  fastify.patch('/:id', async (request: any, reply) => {
    const { id } = request.params
    const response = await controller.update(id, request.body as any, request)
    return reply.status(200).send(response)
  })

  fastify.patch('/:id/inactivate', async (request: any, reply) => {
    return controller.inactivate(request, reply)
  })

  fastify.patch('/:id/reactivate', async (request: any, reply) => {
    return controller.reactivate(request, reply)
  })

  // NOTA: DELETE /:id não existe de propósito — soft delete only (inativação),
  // igual ao financial-account. Também não há GET /:id (mesmo precedente).
}
