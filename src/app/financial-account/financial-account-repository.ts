import { Document, MongoServerError } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
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
    // Graças ao "protected", podemos pegar a coleção pronta do Pai!
    const collection = this.getCollection(ctx)

    // Índice 1: Duplicidade name+type (Collation case-insensitive)
    // Impede de criar "Caixa Principal" e "CAIXA PRINCIPAL" no mesmo restaurante
    await collection.createIndex(
      { restaurantId: 1, name: 1, type: 1 },
      { unique: true, collation: { locale: 'pt', strength: 2 } },
    )

    // Índice 2: Performance de busca
    await collection.createIndex({ restaurantId: 1, status: 1 })

    // Índice 3: Unique Parcial
    // Garante que só exista 1 conta com "isDefault: true" por restaurante.
    await collection.createIndex(
      { restaurantId: 1 },
      { unique: true, partialFilterExpression: { isDefault: true } },
    )
  }

  /**
   * OVERRIDE DO INSERT (Missão da MIN-64)
   * Interceptamos o insert do Pai para traduzir o erro de duplicidade do Mongo
   */
  async insert (item: FinancialAccount, ctx: RequestContext): Promise<FinancialAccount> {
    try {
      // Chama o insert original da classe pai
      return await super.insert(item as FinancialAccount & Document, ctx)
    } catch (error) {
      // 11000 é o código universal do MongoDB para "Unique Index Violated" (Dado duplicado)
      if (error instanceof MongoServerError && error.code === 11000) {
        // Lançamos um erro claro que o nosso Controller vai transformar em HTTP 409
        throw new Error('Conflict: Já existe uma conta com este nome e tipo neste restaurante.')
      }
      throw error // Repassa erros desconhecidos
    }
  }

  async findAll (filter: any, ctx: RequestContext): Promise<Array<FinancialAccount>> {
    // 1. Pegamos a tabela (Graças ao 'protected' que você alterou!)
    const collection = this.getCollection(ctx)

    // 2. Separamos os dados de paginação dos filtros reais (nome, status, etc)
    const { page = 1, size = 10, orderBy, orderDirection, createdAtDirection, ...queryFilter } = filter

    const pageNum = Number(page) || 1
    const sizeNum = Number(size) || 10
    const skip = (pageNum - 1) * sizeNum

    // 3. A NOSSA INJEÇÃO DO SORT DUPLO!
    // 1 no MongoDB significa "Ordem Crescente (A-Z)"
    // Como "A"tiva vem antes de "I"nativa, o status: 1 resolve o agrupamento perfeitamente.
    // O name: 1 desempata quem tiver o mesmo status.
    const customSort = { status: 1, name: 1 }

    // 4. Rodamos a busca no MongoDB
    const result = await collection
      .find(queryFilter)
      .sort(customSort as any)
      .skip(skip)
      .limit(sizeNum)
      .toArray()

    return result as unknown as FinancialAccount[]
  }
}
