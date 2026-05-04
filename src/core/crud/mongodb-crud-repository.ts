import { Collection, ObjectId, Filter, Document } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from '../types/pagination'

export class MongodbCrudRepository<T extends Document, ID> implements CrudRepository<T, ID> {
  constructor (
    private readonly collectionName: string,
  ) {}

  private getCollection (env: string): Collection<T> {
    const db = MongoDBConnection.getInstance().getDatabase(env)
    return db.collection<T>(this.collectionName)
  }

  async insert (item: T, env: string): Promise<T> {
    const collection = this.getCollection(env)
    const result = await collection.insertOne(item as any)
    return { ...item, _id: result.insertedId } as T
  }

  async findById (id: ID, env: string): Promise<T | null> {
    const collection = this.getCollection(env)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const result = await collection.findOne(filter)
    return result as T | null
  }

  async find (filter: Partial<T>, env: string): Promise<T> {
    const collection = this.getCollection(env)

    const result = await collection.findOne(filter as Filter<T>)

    return result as T
  }

  async findAll (filter: Partial<T> & PaginationDto, env: string): Promise<Array<T>> {
    const collection = this.getCollection(env)
    const { page = 1, size = 10, orderBy, orderDirection = 'asc', createdAtDirection, ...queryFilter } = filter

    const skip = (page - 1) * size
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
      .limit(size)
      .toArray()

    return result as T[]
  }

  async update (id: ID, item: Partial<T>, env: string): Promise<T> {
    const collection = this.getCollection(env)
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

  async delete (id: ID, env: string): Promise<void> {
    const collection = this.getCollection(env)
    const filter = { _id: new ObjectId(id as string) } as Filter<T>
    const result = await collection.deleteOne(filter)

    if (result.deletedCount === 0) {
      throw new Error(`Item com id ${id} não encontrado`)
    }
  }

  async query<Q> (query: Object | Array<any> | string, env: string): Promise<Q> {
    const collection = this.getCollection(env)

    // Se for um array, trata como aggregation pipeline
    if (Array.isArray(query)) {
      const result = await collection.aggregate(query).toArray()
      return result as Q
    }

    // Se for um objeto, trata como filtro de find
    if (typeof query === 'object' && query !== null) {
      const result = await collection.find(query as Filter<T>).toArray()
      return result as Q
    }

    // Se for string, tenta parsear como JSON e executar
    if (typeof query === 'string') {
      try {
        const parsedQuery = JSON.parse(query)
        if (Array.isArray(parsedQuery)) {
          const result = await collection.aggregate(parsedQuery).toArray()
          return result as Q
        }
        const result = await collection.find(parsedQuery as Filter<T>).toArray()
        return result as Q
      } catch (error) {
        throw new Error('Query string inválida. Deve ser um JSON válido.')
      }
    }

    throw new Error('Tipo de query não suportado')
  }
}
