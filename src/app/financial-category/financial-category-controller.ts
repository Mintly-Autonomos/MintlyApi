import { Sapphire } from '@ascendance-hub/sapphire-core'
import { StatusCodes } from 'http-status-codes'
import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource, buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { financialCategoryInsertSchema, financialCategorySchema, financialCategoryUpdateSchema, FinancialCategory, MovementDirection, RecordStatus } from 'mintly-lib'
import { FinancialCategoryRepository } from './financial-category-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { escapeRegex } from '../../core/util/escape-regex'
import { InactivateCategoryUseCase } from './use-cases/inactivate-category.use-case'
import { SuggestCategoriesQuery } from './use-cases/suggest-categories.query'
import { SubcategoryUseCase } from './use-cases/subcategory.use-case'
import { resolveCategoryUpdate, resolveInsertDreGroup } from './category-rules'

const s = new Sapphire()
const directionSchema = s.type().enum(MovementDirection)

export class FinancialCategoryController extends CrudController<FinancialCategory, string> {
  constructor (
    private readonly repo: FinancialCategoryRepository,
    private readonly inactivateUseCase: InactivateCategoryUseCase,
    private readonly suggestQuery: SuggestCategoriesQuery,
    private readonly subcategories: SubcategoryUseCase = new SubcategoryUseCase(repo),
  ) {
    super(
      repo,
      financialCategoryInsertSchema as any,
      financialCategoryUpdateSchema as any,
      Resource.FinancialCategory,
    )
  }

  /** Cadastro: despesa sem grupo recebe `opex`; receita com grupo → 400 (fatia 3). */
  async insert (item: FinancialCategory, source?: ContextSource): Promise<ResponseStructure> {
    // Corpo ausente segue para o parse do schema (400), em vez de quebrar aqui (500).
    return super.insert(resolveInsertDreGroup((item ?? {}) as any), source)
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

    const parsed = financialCategoryUpdateSchema.parse(item) as Record<string, unknown>
    const { set, unsetDreGroup } = resolveCategoryUpdate(current as any, parsed)

    // Coerência tipo × grupo do documento RESULTANTE pela união da lib — o mesmo
    // contrato que o cadastro respeita.
    const { _id, ...stored } = current as any
    const resulting = { ...stored, ...set }
    if (unsetDreGroup) delete resulting.dreGroup
    financialCategorySchema.parse(resulting)

    const result = await this.repo.updateCategory(id, set, unsetDreGroup, ctx)
    return new ResponseBuilder().payload(result).build()
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
      .status(StatusCodes.OK)
      .payload({ message: 'Categoria inativada com sucesso.' })
      .send(reply)
  }

  async reactivate (request: any, reply: any) {
    const { id } = request.params
    const ctx = buildRequestContext(request)
    await this.inactivateUseCase.reactivate(id, ctx)
    return new ResponseBuilder()
      .status(StatusCodes.OK)
      .payload({ message: 'Categoria reativada com sucesso.' })
      .send(reply)
  }

  /** Sub-recurso de subcategorias (fatia 5): 201 com a subcategoria criada. */
  async addSubcategory (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const sub = await this.subcategories.add(request.params.id, request.body, ctx)
    return new ResponseBuilder().status(StatusCodes.CREATED).payload(sub).send(reply)
  }

  async renameSubcategory (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const sub = await this.subcategories.rename(request.params.id, request.params.subId, request.body, ctx)
    return new ResponseBuilder().status(StatusCodes.OK).payload(sub).send(reply)
  }

  async setSubcategoryStatus (request: any, reply: any, status: RecordStatus) {
    const ctx = buildRequestContext(request)
    const sub = await this.subcategories.setStatus(request.params.id, request.params.subId, status, ctx)
    return new ResponseBuilder().status(StatusCodes.OK).payload(sub).send(reply)
  }

  async suggestions (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const direction = directionSchema.parse((request.query as any)?.direction)
    const result = await this.suggestQuery.execute(ctx, direction)
    return new ResponseBuilder()
      .status(StatusCodes.OK)
      .payload(result)
      .send(reply)
  }
}
