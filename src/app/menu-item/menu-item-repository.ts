import { Collection, Document, MongoServerError, ObjectId } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { ensure as ensureMenuItemIndexes } from '../../infrastructure/db/indices/menu-items'
import { MenuItem, RecordStatus } from 'mintly-lib'

const DUPLICATE_MESSAGE = 'Já existe um prato com este nome neste restaurante.'

export class MenuItemRepository extends MongodbCrudRepository<MenuItem & Document, string> {
  constructor () {
    super('menu_items')
  }

  /** Índices desta collection (fonte única em infrastructure/db/indices/menu-items.ts). */
  async createIndexes (ctx: RequestContext): Promise<void> {
    await ensureMenuItemIndexes(this.getCollection(ctx) as unknown as Collection<Document>)
  }

  /**
   * Prato novo: SEMPRE do restaurante do contexto, ativo, com as duas datas de preço em "agora"
   * (cadastrar já conta como revisar o preço). Nada disso vem do body.
   */
  async insert (item: MenuItem, ctx: RequestContext): Promise<MenuItem> {
    const now = new Date()
    const scoped = {
      ...item,
      restaurantId: ctx.restaurantId,
      status: RecordStatus.Active,
      priceUpdatedAt: now,
      priceReviewedAt: now,
    }
    try {
      return await super.insert(scoped as unknown as MenuItem & Document, ctx)
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError(DUPLICATE_MESSAGE)
      throw error
    }
  }

  async update (id: string, item: Partial<MenuItem>, ctx: RequestContext): Promise<MenuItem> {
    try {
      return await super.update(id, item as Partial<MenuItem & Document>, ctx)
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError(DUPLICATE_MESSAGE)
      throw error
    }
  }

  /**
   * Listagem: ativos primeiro, depois por nome (collation pt: ignora caixa e acento). Mesmo
   * cuidado da categoria com `isMultipleResponse` (flag do client, nunca vira filtro Mongo).
   */
  async findAll (filter: any, ctx: RequestContext): Promise<MenuItem[]> {
    const collection = this.getCollection(ctx)
    const { page = 1, size = 10, orderBy, orderDirection, createdAtDirection, isMultipleResponse, ...queryFilter } = filter

    const pageNum = Math.max(1, Math.floor(Number(page) || 1))
    const sizeNum = Math.min(100, Math.max(1, Math.floor(Number(size) || 10)))
    const scopedFilter = { ...this.sanitizeFilter(queryFilter), restaurantId: ctx.restaurantId }

    const result = await collection
      .find(scopedFilter)
      .collation({ locale: 'pt', strength: 1 })
      .sort({ status: 1, name: 1 } as any)
      .skip((pageNum - 1) * sizeNum)
      .limit(sizeNum)
      .toArray()

    return result as unknown as MenuItem[]
  }

  /** Pratos ATIVOS cuja última revisão de preço foi em `cutoff` ou antes — os mais antigos primeiro. */
  async findStale (cutoff: Date, ctx: RequestContext): Promise<MenuItem[]> {
    const result = await this.getCollection(ctx)
      .find({
        restaurantId: ctx.restaurantId,
        status: RecordStatus.Active,
        priceReviewedAt: { $lte: cutoff },
      } as any)
      .sort({ priceReviewedAt: 1 })
      .toArray()
    return result as unknown as MenuItem[]
  }

  /**
   * Aplica um `$set` (preço, datas de revisão ou status) numa única escrita escopada por
   * restaurante, renovando a auditoria. O chamador decide o que entra no `$set` — por exemplo,
   * `priceUpdatedAt` só entra quando o valor mudou de fato.
   */
  async applySet (id: string, set: Record<string, unknown>, ctx: RequestContext): Promise<MenuItem> {
    if (!ObjectId.isValid(id)) throw new NotFoundError(Resource.MenuItem, id)
    const result = await this.getCollection(ctx).findOneAndUpdate(
      { _id: new ObjectId(id), restaurantId: ctx.restaurantId } as any,
      { $set: { ...set, 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId } } as any,
      { returnDocument: 'after' },
    )
    if (!result) throw new NotFoundError(Resource.MenuItem, id)
    return result as unknown as MenuItem
  }
}
