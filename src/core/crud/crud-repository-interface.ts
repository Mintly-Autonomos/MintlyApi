import { PaginationDto } from '../types/pagination'

export interface CrudRepository<T, ID> {
  insert(item: T, env: string): Promise<T>
  findById(id: ID, env: string): Promise<T | null>
  find(filter: Partial<T>, env: string): Promise<T>
  findAll(filter: Partial<T> & PaginationDto, env: string): Promise<Array<T>>
  update(id: ID, item: Partial<T>, env: string): Promise<T>
  delete(id: ID, env: string): Promise<void>
  query<Q>(query: Object | Array<any> | string, env: string): Promise<Q>
}
