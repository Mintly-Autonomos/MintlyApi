import { CrudRepository } from './crud-repository-interface'
import { CrudUseCase } from './crud-use-case'
import { IncomingHttpHeaders } from 'http'
import { GetEnv } from '../utils/get-env'
import { NotFoundError } from '../errors/core/not-found-error'
import { Resource } from '../types/resource'
import { ResponseBuilder } from '../builders/response-builder/response-builder'
import { StatusCodes } from 'http-status-codes'
import { PaginationDto } from '../types/pagination'

interface Validator<T> {
  validate: (value: Partial<T>) => unknown
}

export class CrudController <T extends Record<string, any>, ID = any> {
  private readonly useCase: CrudUseCase<T, ID>

  constructor (
    private readonly repository: CrudRepository<T, ID>,
    private readonly orm: Validator<T>,
  ) {
    const useCase = new CrudUseCase<T, ID>(this.repository)
    this.useCase = useCase
  }

  async insert (item: T, headers?: IncomingHttpHeaders): Promise<T> {
    const env = GetEnv.getEnv(headers)

    this.orm.validate(item)

    const result = await this.useCase.insert(item, env)

    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async findById (id: ID, headers?: IncomingHttpHeaders): Promise<T | null> {
    const env = GetEnv.getEnv(headers)
    const result = await this.useCase.findById(id, env)
    if (!result) {
      throw new NotFoundError(Resource.Person, id)
    }

    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async find (filter: Partial<T>, headers?: IncomingHttpHeaders): Promise<T> {
    const env = GetEnv.getEnv(headers)
    const result = await this.useCase.find(filter, env)

    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async findAll (filter: Partial<T> & PaginationDto, headers?: IncomingHttpHeaders): Promise<Array<T>> {
    const env = GetEnv.getEnv(headers)
    const result = await this.useCase.findAll(filter, env)
    const page = filter.page ?? 1
    const size = filter.size ?? 10

    return new ResponseBuilder()
      .payload(result)
      .pagination({
        ...filter,
        page,
        size,
        totalItems: result.length,
        totalPages: Math.ceil(result.length / size),
      })
      .build()
  }

  async update (id: ID, item: Partial<T>, headers?: IncomingHttpHeaders): Promise<T> {
    const env = GetEnv.getEnv(headers)

    this.orm.validate(item)

    const result = await this.useCase.update(id, item, env)
    return new ResponseBuilder()
      .payload(result)
      .build()
  }

  async delete (id: ID, headers?: IncomingHttpHeaders): Promise<void> {
    const env = GetEnv.getEnv(headers)
    await this.useCase.delete(id, env)

    return new ResponseBuilder()
      .status(StatusCodes.NO_CONTENT)
      .build()
  }
}
