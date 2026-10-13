import { ObjectId } from 'mongodb'
import { RecordStatus, Subcategory, subcategoryInsertSchema, subcategoryUpdateSchema } from 'mintly-lib'
import { FinancialCategoryRepository } from '../financial-category-repository'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { assertUniqueSubcategoryName, findSubcategory, normalizeSubcategoryName } from '../subcategory-rules'

/** Tentativas antes de desistir quando outra gravação muda a categoria no meio. */
const MAX_ATTEMPTS = 5

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

  private names (category: any): string[] {
    return (category.subcategories ?? []).map((s: Subcategory) => s.name)
  }

  /**
   * Lê, decide e grava só se os nomes não mudaram desde a leitura (a regra de
   * unicidade é em memória). Se outra gravação passou na frente, relê e decide de
   * novo — aí o nome repetido vira 409. Sem `write`, não há o que gravar.
   */
  private async withRetry<T> (categoryId: string, ctx: RequestContext, attempt: (category: any, names: string[]) => Promise<{ result: T; write?: () => Promise<boolean> }>): Promise<T> {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const category = await this.category(categoryId, ctx)
      const { result, write } = await attempt(category, this.names(category))
      if (!write || await write()) return result
    }
    throw new ConflictError('A categoria foi alterada ao mesmo tempo por outra pessoa. Tente de novo.')
  }

  async add (categoryId: string, body: unknown, ctx: RequestContext): Promise<Subcategory> {
    const { name: raw } = subcategoryInsertSchema.parse(body ?? {}) as { name: string }
    const name = normalizeSubcategoryName(raw)
    return this.withRetry(categoryId, ctx, async (category, names) => {
      assertUniqueSubcategoryName(category.subcategories, name)
      const sub: Subcategory = { _id: new ObjectId().toHexString(), name, status: RecordStatus.Active }
      return { result: sub, write: () => this.repo.pushSubcategory(categoryId, sub, this.entry(ctx, 'subcategory:add', name), names, ctx) }
    })
  }

  async rename (categoryId: string, subId: string, body: unknown, ctx: RequestContext): Promise<Subcategory> {
    const changes = subcategoryUpdateSchema.parse(body ?? {}) as { name?: string }
    const name = changes.name === undefined ? undefined : normalizeSubcategoryName(changes.name)
    return this.withRetry(categoryId, ctx, async (category, names) => {
      const sub = this.subcategory(category, subId)
      if (name === undefined) return { result: sub }
      assertUniqueSubcategoryName(category.subcategories, name, subId)
      if (name === sub.name) return { result: sub }
      return { result: { ...sub, name }, write: () => this.repo.setSubcategoryFields(categoryId, subId, { name }, this.entry(ctx, 'subcategory:rename', `${sub.name} → ${name}`), names, ctx) }
    })
  }

  /** Idempotente: pedir o status que já está não grava nem registra history. */
  async setStatus (categoryId: string, subId: string, status: RecordStatus, ctx: RequestContext): Promise<Subcategory> {
    return this.withRetry(categoryId, ctx, async (category, names) => {
      const sub = this.subcategory(category, subId)
      if (sub.status === status) return { result: sub }
      const action = status === RecordStatus.Active ? 'subcategory:reactivate' : 'subcategory:inactivate'
      return { result: { ...sub, status }, write: () => this.repo.setSubcategoryFields(categoryId, subId, { status }, this.entry(ctx, action, sub.name), names, ctx) }
    })
  }
}
