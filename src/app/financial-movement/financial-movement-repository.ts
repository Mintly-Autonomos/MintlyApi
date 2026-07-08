import { ClientSession, Collection, Document } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
import { toDecimal128, decimalToNumber } from '../../core/money/money'
import { ensure as ensureFinancialMovementIndexes } from '../../infrastructure/db/indices/financial-movements'
import { escapeRegex } from '../../core/util/escape-regex'
import { FinancialMovement } from 'mintly-lib'

const MONEY_FIELDS = ['grossValue', 'feeValue', 'netValue'] as const

/** Dinheiro do domínio (number) -> Decimal128 (persistência). Muta uma cópia. */
export function movementToStorage<T extends Record<string, any>> (doc: T): T {
  const out: any = { ...doc }
  for (const f of MONEY_FIELDS) {
    if (out[f] != null) out[f] = toDecimal128(out[f])
  }
  return out
}

/** Decimal128 (persistência) -> number (domínio/resposta). */
export function movementFromStorage<T extends Record<string, any>> (doc: T | null): T | null {
  if (!doc) return doc
  const out: any = { ...doc }
  for (const f of MONEY_FIELDS) {
    if (out[f] != null) out[f] = decimalToNumber(out[f])
  }
  return out
}

export interface MovementListFilter {
  q?: string
  direction?: string
  status?: string
  dateFrom?: string | Date
  dateTo?: string | Date
  page?: number | string
  size?: number | string
}

export class FinancialMovementRepository extends MongodbCrudRepository<FinancialMovement & Document, string> {
  constructor () {
    super('financial_movements')
  }

  async createIndexes (ctx: RequestContext): Promise<void> {
    await ensureFinancialMovementIndexes(this.getCollection(ctx) as unknown as Collection<Document>)
  }

  /**
   * Monta o filtro Mongo da listagem (sem paginação): escopo por restaurantId,
   * filtros direction/status/período e busca textual case-insensitive. Fonte
   * única usada por `findAll` E `count`, garantindo contagem consistente.
   */
  private buildListQuery (filter: MovementListFilter, ctx: RequestContext): Record<string, any> {
    const { q, direction, status, dateFrom, dateTo } = filter
    const query: Record<string, any> = { restaurantId: ctx.restaurantId }
    if (direction) query.direction = direction
    if (status) query.status = status

    if (dateFrom || dateTo) {
      query.date = {}
      if (dateFrom) query.date.$gte = new Date(dateFrom)
      if (dateTo) query.date.$lte = new Date(dateTo)
    }

    if (q) {
      const rx = { $regex: escapeRegex(String(q)), $options: 'i' }
      query.$or = [
        { title: rx },
        { 'account.name': rx },
        { 'category.name': rx },
        { paymentMethod: rx },
        { origin: rx },
      ]
    }

    return query
  }

  /**
   * Listagem: ordenação mais recente -> antiga por `date`; busca textual
   * (title/account.name/category.name/paymentMethod/origin) case-insensitive;
   * filtros direction/status/período. Sempre escopada por restaurantId.
   */
  async findAll (filter: MovementListFilter, ctx: RequestContext): Promise<Array<FinancialMovement>> {
    const collection = this.getCollection(ctx)
    const { page = 1, size = 10 } = filter

    const pageNum = Number(page) || 1
    const sizeNum = Number(size) || 10
    const skip = (pageNum - 1) * sizeNum

    const result = await collection
      .find(this.buildListQuery(filter, ctx))
      .sort({ date: -1 })
      .skip(skip)
      .limit(sizeNum)
      .toArray()

    return result.map(d => movementFromStorage(d as any)) as unknown as FinancialMovement[]
  }

  /** Total de movimentações que casam o filtro (ignora paginação) — p/ totalItems/totalPages. */
  async count (filter: MovementListFilter, ctx: RequestContext): Promise<number> {
    return await this.getCollection(ctx).countDocuments(this.buildListQuery(filter, ctx))
  }

  /**
   * Procura uma movimentação potencialmente duplicada: mesmo restaurante, conta,
   * título, valor bruto e data, criada há menos de 2 minutos. (MIN-49 regra 26)
   */
  async findDuplicate (
    criteria: { accountId: string; title: string; grossValue: number; date: Date },
    ctx: RequestContext,
    session?: ClientSession,
  ): Promise<FinancialMovement | null> {
    const collection = this.getCollection(ctx)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    const found = await collection.findOne(
      {
        restaurantId: ctx.restaurantId,
        'account._id': criteria.accountId,
        title: criteria.title,
        grossValue: toDecimal128(criteria.grossValue),
        date: criteria.date,
        'audit.createdAt': { $gte: twoMinutesAgo },
      } as any,
      { session },
    )

    return movementFromStorage(found as any)
  }
}
