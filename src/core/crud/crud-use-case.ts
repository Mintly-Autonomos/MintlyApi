import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from '../types/pagination'

export class CrudUseCase<T, ID> {
  constructor (private readonly repository: CrudRepository<T, ID>) {}

  async insert (item: T, env: string): Promise<T> {
    return await this.repository.insert(item, env)
  }

  async findById (id: ID, env: string): Promise<T | null> {
    return await this.repository.findById(id, env)
  }

  async find (filter: Partial<T>, env: string): Promise<T> {
    return await this.repository.find(filter, env)
  }

  async findAll (filter: Partial<T> & PaginationDto, env: string): Promise<Array<T>> {
    const response = await this.repository.findAll(filter, env)
    return response
  }

  async update (id: ID, item: Partial<T>, env: string): Promise<T> {
    return await this.repository.update(id, item, env)
  }

  async delete (id: ID, env: string): Promise<void> {
    await this.repository.delete(id, env)
  }

  async query<Q> (query: Object | Array<any> | string, env: string): Promise<Q> {
    return await this.repository.query<Q>(query, env)
  }
}
