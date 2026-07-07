import { Collection, ObjectId, Filter, Document, ClientSession } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'
import { Query } from './query'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'
import { NotFoundError } from '../errors/core/not-found-error'

/**
 * Repositório CRUD com backend MongoDB.
 *
 * Suporta os seguintes Query kinds em `.query()`:
 * - `mongo:pipeline` — aggregation pipeline (Document[])
 * - `mongo:filter`   — find com filter (Filter<T>)
 *
 * Lança `UnsupportedQueryKindError` para qualquer outra kind.
 */
export class MongodbCrudRepository<T extends Document, ID> implements CrudRepository<T, ID> {
  constructor (
    private readonly collectionName: string,
  ) {}

  protected getCollection (ctx: RequestContext): Collection<T> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    return db.collection<T>(this.collectionName)
  }

  /**
   * Escopo multi-tenant: limita TODA operação da base ao `restaurantId` do
   * contexto (que vem do JWT validado, nunca de header). Sem isto, o filtro
   * só-por-`_id` de findById/update/delete permite ler/alterar/apagar docs de
   * outro restaurante no mesmo banco (IDOR), e findAll/find listam sem tenant.
   * Quando o contexto não tem `restaurantId` (fluxos internos sem tenant), não
   * adiciona nada — preserva o comportamento anterior.
   */
  protected withTenant (filter: Record<string, any>, ctx: RequestContext): Record<string, any> {
    if (ctx.restaurantId == null) {
      return filter
    }
    return { ...filter, restaurantId: ctx.restaurantId }
  }

  async insert (item: T, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)
    // O doc SEMPRE pertence ao restaurante do contexto: o `restaurantId` do ctx
    // prevalece sobre qualquer valor vindo do body (anti-injeção de tenant).
    const doc = ctx.restaurantId == null ? item : { ...item, restaurantId: ctx.restaurantId }
    const result = await collection.insertOne(doc as any)
    return { ...doc, _id: result.insertedId } as T
  }

  async findById (id: ID, ctx: RequestContext): Promise<T | null> {
    const collection = this.getCollection(ctx)
    const filter = this.withTenant({ _id: new ObjectId(id as string) }, ctx) as Filter<T>
    const result = await collection.findOne(filter)
    return result as T | null
  }

  async find (filter: Partial<T>, ctx: RequestContext, options?: { session?: ClientSession }): Promise<T> {
    const collection = this.getCollection(ctx)

    // _id chega como string nos use cases; normaliza p/ ObjectId (igual a findById/update/delete).
    // Não toca em _id quando é operador (ex.: { $ne: ObjectId }).
    const normalized: any = { ...filter }
    if (typeof normalized._id === 'string') {
      normalized._id = new ObjectId(normalized._id)
    }

    const result = await collection.findOne(this.withTenant(normalized, ctx) as Filter<T>, { session: options?.session })
    return result as T
  }

  async findAll (filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>> {
    const collection = this.getCollection(ctx)
    const { page = 1, size = 10, orderBy, orderDirection = 'asc', createdAtDirection, ...queryFilter } = filter

    // query params chegam como string — coerciona para number antes de skip/limit
    const pageNum = Number(page) || 1
    const sizeNum = Number(size) || 10
    const skip = (pageNum - 1) * sizeNum
    const sort: any = {}

    if (orderBy) {
      sort[orderBy] = orderDirection === 'asc' ? 1 : -1
    }

    if (createdAtDirection) {
      sort.createdAt = createdAtDirection === 'asc' ? 1 : -1
    }

    const result = await collection
      .find(this.withTenant(queryFilter, ctx) as Filter<T>)
      .sort(sort)
      .skip(skip)
      .limit(sizeNum)
      .toArray()

    return result as T[]
  }

  async update (id: ID, item: Partial<T>, ctx: RequestContext, options?: { session?: ClientSession }): Promise<T> {
    const collection = this.getCollection(ctx)
    const filter = this.withTenant({ _id: new ObjectId(id as string) }, ctx) as Filter<T>
    const updateDoc = { $set: item }

    const result = await collection.findOneAndUpdate(
      filter,
      updateDoc,
      { returnDocument: 'after', session: options?.session },
    )

    if (!result) {
      throw new NotFoundError(this.collectionName, id)
    }

    return result as T
  }

  async delete (id: ID, ctx: RequestContext): Promise<void> {
    const collection = this.getCollection(ctx)
    const filter = this.withTenant({ _id: new ObjectId(id as string) }, ctx) as Filter<T>
    const result = await collection.deleteOne(filter)

    if (result.deletedCount === 0) {
      throw new NotFoundError(this.collectionName, id)
    }
  }

  async query<Q> (q: Query, ctx: RequestContext): Promise<Q> {
    const collection = this.getCollection(ctx)

    switch (q.kind) {
      case 'mongo:pipeline': {
        const result = await collection.aggregate(q.pipeline).toArray()
        return result as Q
      }
      case 'mongo:filter': {
        const result = await collection.find(this.withTenant(q.filter as Record<string, any>, ctx) as Filter<T>).toArray()
        return result as Q
      }
      default:
        throw new UnsupportedQueryKindError(q.kind, 'mongodb')
    }
  }
}
