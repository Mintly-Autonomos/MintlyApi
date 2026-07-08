import { Collection, Document, MongoServerError } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ensure as ensureFinancialCategoryIndexes } from '../../infrastructure/db/indices/financial-categories'
import { FinancialCategory, CategoryType, RecordStatus } from 'mintly-lib'

export class FinancialCategoryRepository extends MongodbCrudRepository<FinancialCategory & Document, string> {
  constructor () {
    super('financial_categories')
  }

  /**
   * Fonte única dos índices desta collection (src/infrastructure/db/indices/financial-categories.ts),
   * a mesma usada pelo runner do pipeline (`npm run db:indices`). Aqui serve aos testes de
   * integração, que garantem os índices antes de exercitar as regras.
   */
  async createIndexes (ctx: RequestContext): Promise<void> {
    await ensureFinancialCategoryIndexes(this.getCollection(ctx) as unknown as Collection<Document>)
  }

  /**
   * OVERRIDE DO INSERT:
   * - FIX (tenant scoping): força restaurantId do contexto autenticado, ignorando o body.
   * - FIX (imutabilidade isSystem): categorias criadas via API NUNCA são isSystem — as 6
   *   categorias padrão só existem via onboarding (register-use-case.ts), que insere direto
   *   na collection. Isso impede um cliente de se autodeclarar isSystem:true.
   * - FIX (usage/history): CrudController.insert só valida com o schema (que declara
   *   .default(0)/.default([])) mas descarta o resultado parseado, então os defaults do
   *   Sapphire nunca chegam ao item persistido. Como usage/history são computados pelo
   *   RegisterMovementUseCase e não editáveis via CRUD (ver schema), forçamos aqui os
   *   valores iniciais e ignoramos qualquer valor enviado no body.
   * - FIX (409): traduz o erro 11000 do Mongo (índice unique name+type) em ConflictError.
   */
  async insert (item: FinancialCategory, ctx: RequestContext): Promise<FinancialCategory> {
    const scopedItem = {
      ...item,
      restaurantId: ctx.restaurantId,
      isSystem: false,
      usage: 0,
      history: [],
    }

    try {
      return await super.insert(scopedItem as unknown as FinancialCategory & Document, ctx)
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictError('Já existe uma categoria com este nome e tipo neste restaurante.')
      }
      throw error
    }
  }

  /**
   * OVERRIDE DO FINDALL:
   * - FIX (tenant scoping): nunca lista categorias de outro restaurante.
   * - Ordenação: status:1 agrupa "active" antes de "inactive" (ASCII: 'active' < 'inactive');
   *   name:1 desempata. Collation pt torna a ordenação alfabética real (ignora caixa/acento).
   * - FIX (isMultipleResponse): o HttpBaseClient.findAll() da mintly-lib sempre manda
   *   isMultipleResponse=true na query, mas nenhum documento tem esse campo — se ele vazasse
   *   pro filtro do Mongo, a listagem via client oficial sempre voltaria vazia.
   */
  async findAll (filter: any, ctx: RequestContext): Promise<Array<FinancialCategory>> {
    const collection = this.getCollection(ctx)
    const { page = 1, size = 10, orderBy, orderDirection, createdAtDirection, isMultipleResponse, ...queryFilter } = filter

    // Clamp (igual à base): page >= 1 evita skip negativo (500); size 1..100.
    const pageNum = Math.max(1, Math.floor(Number(page) || 1))
    const sizeNum = Math.min(100, Math.max(1, Math.floor(Number(size) || 10)))
    const skip = (pageNum - 1) * sizeNum

    // sanitizeFilter: remove operadores Mongo ($…) de query param (anti-injeção;
    // sem isso o override furava a proteção da base e divergia do count).
    const scopedFilter = { ...this.sanitizeFilter(queryFilter), restaurantId: ctx.restaurantId }
    const customSort = { status: 1, name: 1 }

    const result = await collection
      .find(scopedFilter)
      .collation({ locale: 'pt', strength: 1 })
      .sort(customSort as any)
      .skip(skip)
      .limit(sizeNum)
      .toArray()

    return result as unknown as FinancialCategory[]
  }

  /**
   * SuggestCategoriesQuery (MIN-71): categorias ativas do tipo pedido, ordenadas por
   * recência (lastUsedAt desc) + frequência (usage desc). Read-only, sem paginação —
   * é uma lista curta de sugestão, não uma listagem completa (limit padrão 10).
   */
  async findSuggestions (ctx: RequestContext, type: CategoryType, limit = 10): Promise<FinancialCategory[]> {
    const collection = this.getCollection(ctx)

    const result = await collection
      .find({ restaurantId: ctx.restaurantId, status: RecordStatus.Active, type } as any)
      .sort({ lastUsedAt: -1, usage: -1 })
      .limit(limit)
      .toArray()

    return result as unknown as FinancialCategory[]
  }
}
