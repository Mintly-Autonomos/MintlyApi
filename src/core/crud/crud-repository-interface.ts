import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'

export interface CrudRepository<T, ID> {
  insert(item: T, ctx: RequestContext): Promise<T>
  findById(id: ID, ctx: RequestContext): Promise<T | null>
  find(filter: Partial<T>, ctx: RequestContext): Promise<T>
  findAll(filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>>
  update(id: ID, item: Partial<T>, ctx: RequestContext): Promise<T>
  delete(id: ID, ctx: RequestContext): Promise<void>
  query<Q>(query: Object | Array<any> | string, ctx: RequestContext): Promise<Q>
}
