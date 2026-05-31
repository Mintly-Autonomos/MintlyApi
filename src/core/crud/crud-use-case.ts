import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'

export class CrudUseCase<T, ID> {
  constructor (private readonly repository: CrudRepository<T, ID>) {}

  async insert (item: T, ctx: RequestContext): Promise<T> {
    return await this.repository.insert(item, ctx)
  }

  async findById (id: ID, ctx: RequestContext): Promise<T | null> {
    return await this.repository.findById(id, ctx)
  }

  async find (filter: Partial<T>, ctx: RequestContext): Promise<T> {
    return await this.repository.find(filter, ctx)
  }

  async findAll (filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>> {
    const response = await this.repository.findAll(filter, ctx)
    return response
  }

  async update (id: ID, item: Partial<T>, ctx: RequestContext): Promise<T> {
    return await this.repository.update(id, item, ctx)
  }

  async delete (id: ID, ctx: RequestContext): Promise<void> {
    await this.repository.delete(id, ctx)
  }

  async query<Q> (query: Object | Array<any> | string, ctx: RequestContext): Promise<Q> {
    return await this.repository.query<Q>(query, ctx)
  }
}
