import { CrudRepository } from './crud-repository-interface'
import { CrudUseCase } from './crud-use-case'
import { buildRequestContext, ContextSource } from '../context/build-request-context'
import { PaginationDto } from 'mintly-lib'
import { Field } from '@ascendance-hub/sapphire-core'
import { NotFoundError } from '../errors/core/not-found-error'
import { Resource } from '../types/resource'
import { ResponseBuilder, ResponseStructure } from '../builders/response-builder/response-builder'

export class CrudController <T extends Record<string, any>, ID = any> {
  private readonly useCase: CrudUseCase<T, ID>

  constructor (
    private readonly repository: CrudRepository<T, ID>,
    private readonly orm: Field,
    private readonly ormPartial: Field = orm,
  ) {
    const useCase = new CrudUseCase<T, ID>(this.repository)
    this.useCase = useCase
  }

  async insert (item: T, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    this.orm.parse(item)
    const result = await this.useCase.insert(item, ctx)
    return new ResponseBuilder().payload(result).build() as ResponseStructure
  }

  async findById (id: ID, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    const result = await this.useCase.findById(id, ctx)
    if (!result) {
      throw new NotFoundError(Resource.Person, id)
    }
    return new ResponseBuilder().payload(result).build() as ResponseStructure
  }

  async find (filter: Partial<T>, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    const result = await this.useCase.find(filter, ctx)
    return new ResponseBuilder().payload(result).build() as ResponseStructure
  }

  async findAll (filter: Partial<T> & PaginationDto, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    const result = await this.useCase.findAll(filter, ctx)
    return new ResponseBuilder()
      .payload(result)
      .pagination({
        ...filter,
        totalItems: result.length,
        totalPages: Math.ceil(result.length / (filter.size || 10)),
      })
      .build() as ResponseStructure
  }

  async update (id: ID, item: Partial<T>, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    this.ormPartial.parse(item)
    const result = await this.useCase.update(id, item, ctx)
    return new ResponseBuilder().payload(result).build() as ResponseStructure
  }

  async delete (id: ID, source?: ContextSource): Promise<void> {
    const ctx = buildRequestContext(source)
    await this.useCase.delete(id, ctx)
  }
}
