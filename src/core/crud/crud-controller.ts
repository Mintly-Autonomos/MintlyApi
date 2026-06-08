import { CrudRepository } from './crud-repository-interface'
import { CrudUseCase } from './crud-use-case'
import { IncomingHttpHeaders } from 'http'
import { buildRequestContext } from '../context/build-request-context'
import { PaginationDto } from 'mintly-lib'
import { Field } from '@ascendance-hub/sapphire-core'
import { NotFoundError } from '../errors/core/not-found-error'
import { Resource } from '../types/resource'

export class CrudController <T extends Record<string, any>, ID = any> {
  private readonly useCase: CrudUseCase<T, ID>

  constructor (
    private readonly repository: CrudRepository<T, ID>,
    private readonly orm: Field,
  ) {
    const useCase = new CrudUseCase<T, ID>(this.repository)
    this.useCase = useCase
  }

  async insert (item: T, headers?: IncomingHttpHeaders): Promise<{ payload: T }> {
    const ctx = buildRequestContext(headers)
    this.orm.parse(item)
    const result = await this.useCase.insert(item, ctx)
    return { payload: result }
  }

  async findById (id: ID, headers?: IncomingHttpHeaders): Promise<{ payload: T }> {
    const ctx = buildRequestContext(headers)
    const result = await this.useCase.findById(id, ctx)
    if (!result) {
      throw new NotFoundError(Resource.Person, id)
    }
    return { payload: result }
  }

  async find (filter: Partial<T>, headers?: IncomingHttpHeaders): Promise<{ payload: T }> {
    const ctx = buildRequestContext(headers)
    const result = await this.useCase.find(filter, ctx)
    return { payload: result }
  }

  async findAll (filter: Partial<T> & PaginationDto, headers?: IncomingHttpHeaders): Promise<{ payload: Array<T>; pagination: object }> {
    const ctx = buildRequestContext(headers)
    const result = await this.useCase.findAll(filter, ctx)
    return {
      payload: result,
      pagination: {
        ...filter,
        totalItems: result.length,
        totalPages: Math.ceil(result.length / (filter.size || 10)),
      },
    }
  }

  async update (id: ID, item: Partial<T>, headers?: IncomingHttpHeaders): Promise<{ payload: T }> {
    const ctx = buildRequestContext(headers)
    this.orm.parse(item)
    const result = await this.useCase.update(id, item, ctx)
    return { payload: result }
  }

  async delete (id: ID, headers?: IncomingHttpHeaders): Promise<null> {
    const ctx = buildRequestContext(headers)
    await this.useCase.delete(id, ctx)
    return null
  }
}
