import { ObjectId } from 'mongodb'
import { RecordStatus, Subcategory, subcategoryInsertSchema, subcategoryUpdateSchema } from 'mintly-lib'
import { FinancialCategoryRepository } from '../financial-category-repository'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { Resource } from '../../../core/types/resource'
import { assertUniqueSubcategoryName, findSubcategory, normalizeSubcategoryName } from '../subcategory-rules'

/**
 * Sub-recurso de subcategorias (M4, fatia 5). Funciona em QUALQUER categoria do
 * restaurante, inclusive de sistema (S2): não passa pelo PATCH da categoria, que
 * segue travado para sistema. Cada mudança vai para o history da categoria.
 */
export class SubcategoryUseCase {
  constructor (private readonly repo: FinancialCategoryRepository = new FinancialCategoryRepository()) {}

  private async category (categoryId: string, ctx: RequestContext): Promise<any> {
    if (!ObjectId.isValid(categoryId)) throw new NotFoundError(Resource.FinancialCategory, categoryId)
    const category = await this.repo.find({ _id: categoryId as any, restaurantId: ctx.restaurantId } as any, ctx)
    if (!category) throw new NotFoundError(Resource.FinancialCategory, categoryId)
    return category
  }

  private subcategory (category: any, subId: string): Subcategory {
    const sub = findSubcategory(category, subId)
    if (!sub) throw new NotFoundError('Subcategory', subId)
    return sub
  }

  private entry (ctx: RequestContext, action: string, detail: string) {
    return { at: new Date(), by: ctx.userId ?? 'system', action, detail }
  }

  async add (categoryId: string, body: unknown, ctx: RequestContext): Promise<Subcategory> {
    const { name: raw } = subcategoryInsertSchema.parse(body ?? {}) as { name: string }
    const category = await this.category(categoryId, ctx)
    const name = normalizeSubcategoryName(raw)
    assertUniqueSubcategoryName(category.subcategories, name)
    const sub: Subcategory = { _id: new ObjectId().toHexString(), name, status: RecordStatus.Active }
    await this.repo.pushSubcategory(categoryId, sub, this.entry(ctx, 'subcategory:add', name), ctx)
    return sub
  }

  async rename (categoryId: string, subId: string, body: unknown, ctx: RequestContext): Promise<Subcategory> {
    const changes = subcategoryUpdateSchema.parse(body ?? {}) as { name?: string }
    const category = await this.category(categoryId, ctx)
    const sub = this.subcategory(category, subId)
    if (changes.name === undefined) return sub
    const name = normalizeSubcategoryName(changes.name)
    assertUniqueSubcategoryName(category.subcategories, name, subId)
    if (name === sub.name) return sub
    await this.repo.setSubcategoryFields(categoryId, subId, { name }, this.entry(ctx, 'subcategory:rename', `${sub.name} → ${name}`), ctx)
    return { ...sub, name }
  }

  /** Idempotente: pedir o status que já está não grava nem registra history. */
  async setStatus (categoryId: string, subId: string, status: RecordStatus, ctx: RequestContext): Promise<Subcategory> {
    const category = await this.category(categoryId, ctx)
    const sub = this.subcategory(category, subId)
    if (sub.status === status) return sub
    const action = status === RecordStatus.Active ? 'subcategory:reactivate' : 'subcategory:inactivate'
    await this.repo.setSubcategoryFields(categoryId, subId, { status }, this.entry(ctx, action, sub.name), ctx)
    return { ...sub, status }
  }
}
