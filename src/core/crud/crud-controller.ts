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
    // Recurso deste controller — usado nas mensagens de 404. Sem injetar, o 404
    // reportava "Person" p/ qualquer recurso (conta, categoria...).
    private readonly resource: Resource = Resource.Person,
  ) {
    const useCase = new CrudUseCase<T, ID>(this.repository)
    this.useCase = useCase
  }

  async insert (item: T, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    // Usa o valor COAGIDO/sanitizado do parse (não o body cru): descarta chaves
    // desconhecidas (mass assignment) e aplica coerção do schema.
    const parsed = this.orm.parse(item) as T
    const result = await this.useCase.insert(parsed, ctx)
    return new ResponseBuilder().payload(result).build() as ResponseStructure
  }

  async findById (id: ID, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    const result = await this.useCase.findById(id, ctx)
    if (!result) {
      throw new NotFoundError(this.resource, id)
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
    // `totalItems` é o total de documentos que casam o filtro (via countDocuments),
    // não o tamanho da página — senão `totalPages` fica sempre 1 e o front não pagina.
    const [result, totalItems] = await Promise.all([
      this.useCase.findAll(filter, ctx),
      this.useCase.count(filter, ctx),
    ])
    const size = Number(filter.size) || 10
    return new ResponseBuilder()
      .payload(result)
      .pagination({
        ...filter,
        totalItems,
        totalPages: Math.ceil(totalItems / size),
      })
      .build() as ResponseStructure
  }

  async update (id: ID, item: Partial<T>, source?: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    const parsed = this.ormPartial.parse(item) as Partial<T>
    const result = await this.useCase.update(id, parsed, ctx)
    return new ResponseBuilder().payload(result).build() as ResponseStructure
  }

  async delete (id: ID, source?: ContextSource): Promise<void> {
    const ctx = buildRequestContext(source)
    await this.useCase.delete(id, ctx)
  }
}
