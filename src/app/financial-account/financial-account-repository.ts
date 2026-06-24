import { Document, MongoServerError } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { FinancialAccount } from 'mintly-lib'

export class FinancialAccountRepository extends MongodbCrudRepository<FinancialAccount & Document, string> {
  constructor () {
    super('financial_accounts')
  }

  /**
   * INICIALIZAÇÃO DE ÍNDICES (Missão da MIN-64)
   * Chamamos isso quando o servidor sobe para blindar o banco de dados.
   */
  async createIndexes (ctx: RequestContext): Promise<void> {
    const collection = this.getCollection(ctx)

    // Índice 1: Duplicidade name+type (Collation case-insensitive)
    await collection.createIndex(
      { restaurantId: 1, name: 1, type: 1 },
      { unique: true, collation: { locale: 'pt', strength: 2 } },
    )

    // Índice 2: Performance de busca
    await collection.createIndex({ restaurantId: 1, status: 1 })

    // Índice 3: Unique Parcial — só 1 conta com isDefault:true por restaurante
    await collection.createIndex(
      { restaurantId: 1 },
      { unique: true, partialFilterExpression: { isDefault: true } },
    )
  }

  /**
   * OVERRIDE DO INSERT (Missão da MIN-64)
   * - FIX (tenant scoping): força restaurantId do contexto autenticado, ignorando
   *   o que vier no body. Um cliente não pode mais criar conta para outro restaurante.
   * - FIX (409): traduz o erro 11000 do Mongo em ConflictError, que o error handler
   *   global mapeia para HTTP 409 (Error cru viraria 500).
   */
  async insert (item: FinancialAccount, ctx: RequestContext): Promise<FinancialAccount> {
    // A conta SEMPRE pertence ao restaurante do contexto, nunca ao restaurantId do payload.
    const scopedItem = { ...item, restaurantId: ctx.restaurantId }

    try {
      return await super.insert(scopedItem as FinancialAccount & Document, ctx)
    } catch (error) {
      // 11000 = violação de índice unique (dado duplicado)
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictError('Já existe uma conta com este nome e tipo neste restaurante.')
      }
      throw error // Repassa erros desconhecidos
    }
  }

  async findAll (filter: any, ctx: RequestContext): Promise<Array<FinancialAccount>> {
    const collection = this.getCollection(ctx)

    // Separa paginação dos filtros reais (nome, status, etc)
    const { page = 1, size = 10, orderBy, orderDirection, createdAtDirection, ...queryFilter } = filter

    const pageNum = Number(page) || 1
    const sizeNum = Number(size) || 10
    const skip = (pageNum - 1) * sizeNum

    // FIX (tenant scoping): nunca lista contas de outro restaurante.
    const scopedFilter = { ...queryFilter, restaurantId: ctx.restaurantId }

    // Sort duplo: status:1 agrupa "active" antes de "inactive"; name:1 desempata.
    const customSort = { status: 1, name: 1 }

    // FIX (ordenação alfabética real): collation pt ignora caixa/acento,
    // coerente com o índice unique. Sem isso, ordem ASCII colocaria "Z" antes de "a".
    const result = await collection
      .find(scopedFilter)
      .collation({ locale: 'pt', strength: 1 })
      .sort(customSort as any)
      .skip(skip)
      .limit(sizeNum)
      .toArray()

    return result as unknown as FinancialAccount[]
  }
}