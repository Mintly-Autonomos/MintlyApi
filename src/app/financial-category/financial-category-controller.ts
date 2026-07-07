import { Sapphire } from '@ascendance-hub/sapphire-core'
import { StatusCodes } from 'http-status-codes'
import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource, buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { financialCategoryInsertSchema, financialCategoryUpdateSchema, FinancialCategory, MovementDirection } from 'mintly-lib'
import { FinancialCategoryRepository } from './financial-category-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { InactivateCategoryUseCase } from './use-cases/inactivate-category.use-case'
import { SuggestCategoriesQuery } from './use-cases/suggest-categories.query'

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const s = new Sapphire()
const directionSchema = s.type().enum(MovementDirection)

export class FinancialCategoryController extends CrudController<FinancialCategory, string> {
  constructor (
    private readonly repo: FinancialCategoryRepository,
    private readonly inactivateUseCase: InactivateCategoryUseCase,
    private readonly suggestQuery: SuggestCategoriesQuery,
  ) {
    super(
      repo,
      financialCategoryInsertSchema as any,
      financialCategoryUpdateSchema as any,
      Resource.FinancialCategory,
    )
  }

  async update (id: string, item: Partial<FinancialCategory>, source?: ContextSource): Promise<ResponseStructure> {
    // status é excluído do update genérico de propósito — só muda via
    // /:id/inactivate ou /:id/reactivate, que registram no history[] (ver Global
    // Constraints do plano: garante que toda mudança de status fica auditada).
    if ((item as any).status !== undefined) {
      throw new ConflictError('O campo status não pode ser editado diretamente. Use /:id/inactivate ou /:id/reactivate.')
    }

    const ctx = buildRequestContext(source)
    const current = await this.repo.find({ _id: id as any, restaurantId: ctx.restaurantId } as any, ctx)

    if (!current) {
      throw new NotFoundError(Resource.FinancialCategory, id)
    }

    if ((current as any).isSystem === true) {
      throw new ConflictError('Categorias do sistema não podem ser editadas. Use /:id/inactivate ou /:id/reactivate para mudar o status.')
    }

    return super.update(id, item, source)
  }

  async findAll (filter: any, source?: ContextSource): Promise<ResponseStructure> {
    if (filter.name) {
      filter.name = { $regex: escapeRegex(String(filter.name)), $options: 'i' }
    }
    return super.findAll(filter, source)
  }

  async inactivate (request: any, reply: any) {
    const { id } = request.params
    const ctx = buildRequestContext(request)
    await this.inactivateUseCase.inactivate(id, ctx)
    return new ResponseBuilder()
      .response(reply).status(StatusCodes.OK)
      .payload({ message: 'Categoria inativada com sucesso.' })
      .build()
  }

  async reactivate (request: any, reply: any) {
    const { id } = request.params
    const ctx = buildRequestContext(request)
    await this.inactivateUseCase.reactivate(id, ctx)
    return new ResponseBuilder()
      .response(reply).status(StatusCodes.OK)
      .payload({ message: 'Categoria reativada com sucesso.' })
      .build()
  }

  async suggestions (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const direction = directionSchema.parse((request.query as any)?.direction)
    const result = await this.suggestQuery.execute(ctx, direction)
    return new ResponseBuilder()
      .response(reply).status(StatusCodes.OK)
      .payload(result)
      .build()
  }
}
