import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from 'mintly-lib'
import { RequestContext } from '../context/request-context'
import { Query } from './query'

export class CrudUseCase<T, ID> {
  constructor (private readonly repository: CrudRepository<T, ID>) {}

  async insert (item: T, ctx: RequestContext): Promise<T> {
    // Auditoria é autoritativa do servidor: preenchida aqui no insert (não vem
    // do client). Os insert-schemas da mintly-lib deixam `audit` opcional
    // justamente porque este passo o preenche — o que o client mandar é ignorado.
    const now = new Date()
    const withAudit = {
      ...(item as Record<string, unknown>),
      audit: {
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    } as T
    return await this.repository.insert(withAudit, ctx)
  }

  async findById (id: ID, ctx: RequestContext): Promise<T | null> {
    return await this.repository.findById(id, ctx)
  }

  async find (filter: Partial<T>, ctx: RequestContext): Promise<T | null> {
    return await this.repository.find(filter, ctx)
  }

  async findAll (filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<Array<T>> {
    const response = await this.repository.findAll(filter, ctx)
    return response
  }

  async count (filter: Partial<T> & PaginationDto, ctx: RequestContext): Promise<number> {
    return await this.repository.count(filter, ctx)
  }

  async update (id: ID, item: Partial<T>, ctx: RequestContext): Promise<T> {
    // Campos autoritativos do servidor: nunca vêm do client no update. `audit`,
    // `restaurantId` e `_id` são descartados (senão o PATCH poderia forjar o
    // dono do tenant ou sobrescrever a auditoria). A auditoria é renovada aqui,
    // via dot-notation, p/ não clobbar `createdAt/By` no `$set`.
    const { audit, restaurantId, _id, ...safe } = item as Record<string, unknown>
    const withAudit = {
      ...safe,
      'audit.updatedAt': new Date(),
      'audit.updatedBy': ctx.userId,
    } as unknown as Partial<T>
    return await this.repository.update(id, withAudit, ctx)
  }

  async delete (id: ID, ctx: RequestContext): Promise<void> {
    await this.repository.delete(id, ctx)
  }

  async query<Q> (q: Query, ctx: RequestContext): Promise<Q> {
    return await this.repository.query<Q>(q, ctx)
  }
}
