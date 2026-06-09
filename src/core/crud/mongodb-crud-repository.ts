import { Collection, ObjectId, Filter, Document } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'
import { Query } from './query'
import { UnsupportedQueryKindError } from '../errors/core/unsupported-query-kind-error'

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

  private getCollection (ctx: RequestContext): Collection<T> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    return db.collection<T>(this.collectionName)
  }

  async insert (item: T, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)
    const result = await collection.insertOne(item as any)
    return { ...item, _id: result.insertedId } as T
  }

  async findById (id: ID, ctx: RequestContext): Promise<T | null> {
    const collection = this.getCollection(ctx)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const result = await collection.findOne(filter)
    return result as T | null
  }

  async find (filter: Partial<T>, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)

    const result = await collection.findOne(filter as Filter<T>)

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
      .find(queryFilter as Filter<T>)
      .sort(sort)
      .skip(skip)
      .limit(sizeNum)
      .toArray()

    return result as T[]
  }

  async update (id: ID, item: Partial<T>, ctx: RequestContext): Promise<T> {
    const collection = this.getCollection(ctx)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const updateDoc = { $set: item }

    const result = await collection.findOneAndUpdate(
      filter,
      updateDoc,
      { returnDocument: 'after' },
    )

    if (!result) {
      throw new Error(`Item com id ${id} não encontrado`)
    }

    return result as T
  }

  async delete (id: ID, ctx: RequestContext): Promise<void> {
    const collection = this.getCollection(ctx)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const result = await collection.deleteOne(filter)

    if (result.deletedCount === 0) {
      throw new Error(`Item com id ${id} não encontrado`)
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
        const result = await collection.find(q.filter as Filter<T>).toArray()
        return result as Q
      }
      default:
        throw new UnsupportedQueryKindError(q.kind, 'mongodb')
    }
  }
}
