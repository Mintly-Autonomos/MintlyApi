import { Collection, Document, MongoServerError, ObjectId } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { ensure as ensureFinancialCategoryIndexes } from '../../infrastructure/db/indices/financial-categories'
import { FinancialCategory, CategoryType, RecordStatus, Subcategory } from 'mintly-lib'

/** Documento antigo (antes da fatia 5) não tem o campo: lê como lista vazia. */
const withSubcategories = (doc: any) => ({ ...doc, subcategories: doc.subcategories ?? [] })

/** Filtro "os nomes das subcategorias são exatamente estes, na mesma ordem". */
const namesUnchanged = (names: string[]) => ({
  $expr: { $eq: [{ $map: { input: { $ifNull: ['$subcategories', []] }, in: '$$this.name' } }, names] },
})

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
      // Fatia 5: a lista só muda pelo sub-recurso (/:id/subcategories).
      subcategories: [],
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

    return result.map(withSubcategories) as unknown as FinancialCategory[]
  }

  /** Leitura de uma categoria: documento antigo ganha `subcategories: []` (fatia 5, sem backfill). */
  async find (filter: any, ctx: RequestContext, options?: { session?: any }): Promise<FinancialCategory | null> {
    const result = await super.find(filter, ctx, options)
    return result ? withSubcategories(result) as FinancialCategory : null
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

    return result.map(withSubcategories) as unknown as FinancialCategory[]
  }

  /**
   * PATCH de categoria com a regra do dreGroup (fatia 3): `$set` das mudanças e,
   * quando a categoria vira receita, `$unset` do grupo — o update genérico só
   * sabe fazer `$set`. Escopado por restaurantId.
   */
  async updateCategory (id: string, set: Record<string, unknown>, unsetDreGroup: boolean, ctx: RequestContext): Promise<FinancialCategory> {
    if (!ObjectId.isValid(id)) throw new NotFoundError(Resource.FinancialCategory, id)
    // Auditoria é do servidor, como no update genérico que esta rota substituiu.
    const update: Record<string, unknown> = {
      $set: { ...set, 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId },
    }
    if (unsetDreGroup) update.$unset = { dreGroup: '' }

    const result = await this.getCollection(ctx).findOneAndUpdate(
      { _id: new ObjectId(id), restaurantId: ctx.restaurantId } as any,
      update,
      { returnDocument: 'after' },
    )
    if (!result) throw new NotFoundError(Resource.FinancialCategory, id)
    return withSubcategories(result) as unknown as FinancialCategory
  }

  /**
   * Acrescenta uma subcategoria (fatia 5). O $push cria a lista em documento antigo.
   * Concorrência otimista: só grava se os nomes ainda são os lidos (`expectedNames`)
   * — a unicidade sem diferenciar maiúsculas é checada em memória, então duas
   * gravações simultâneas não podem passar pelo mesmo estado. `false` = mudou.
   */
  async pushSubcategory (categoryId: string, sub: Subcategory, entry: Record<string, unknown>, expectedNames: string[], ctx: RequestContext): Promise<boolean> {
    const result = await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(categoryId), restaurantId: ctx.restaurantId, ...namesUnchanged(expectedNames) } as any,
      { $push: { subcategories: sub, history: entry } as any, $set: { 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId } as any },
    )
    return result.matchedCount === 1
  }

  /** Altera campos de UMA subcategoria (arrayFilters), registrando no history. Mesma guarda de concorrência. */
  async setSubcategoryFields (categoryId: string, subId: string, fields: Partial<Pick<Subcategory, 'name' | 'status'>>, entry: Record<string, unknown>, expectedNames: string[], ctx: RequestContext): Promise<boolean> {
    const $set: Record<string, unknown> = { 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId }
    for (const [k, v] of Object.entries(fields)) $set[`subcategories.$[s].${k}`] = v
    const result = await this.getCollection(ctx).updateOne(
      { _id: new ObjectId(categoryId), restaurantId: ctx.restaurantId, ...namesUnchanged(expectedNames) } as any,
      { $set, $push: { history: entry } as any } as any,
      { arrayFilters: [{ 's._id': subId }] },
    )
    return result.matchedCount === 1
  }
}
