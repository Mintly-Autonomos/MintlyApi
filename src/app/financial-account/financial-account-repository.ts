import { Collection, Document, MongoServerError } from 'mongodb'
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { RequestContext } from '../../core/context/request-context'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ensure as ensureFinancialAccountIndexes } from '../../infrastructure/db/indices/financial-accounts'
import { toDecimal128, decimalToNumber } from '../../core/money/money'
import { FinancialAccount } from 'mintly-lib'

/** Saldos são persistidos como Decimal128 (dinheiro exato); a leitura volta a number. */
function balancesToNumber<T extends Record<string, any>> (doc: T): T {
  return {
    ...doc,
    availableBalance: decimalToNumber(doc.availableBalance),
    predictedBalance: decimalToNumber(doc.predictedBalance),
  }
}

export class FinancialAccountRepository extends MongodbCrudRepository<FinancialAccount & Document, string> {
  constructor () {
    super('financial_accounts')
  }

  /**
   * INICIALIZAÇÃO DE ÍNDICES (Missão da MIN-64)
   * Delega para a fonte única dos índices desta collection
   * (src/infrastructure/db/indices/financial-accounts.ts), a mesma usada pelo
   * runner do pipeline (`npm run db:indices`). Aqui serve aos testes de
   * integração, que garantem os índices antes de exercitar as regras.
   */
  async createIndexes (ctx: RequestContext): Promise<void> {
    await ensureFinancialAccountIndexes(this.getCollection(ctx) as unknown as Collection<Document>)
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
    const scopedItem = {
      ...item,
      restaurantId: ctx.restaurantId,
      // Saldos iniciam SEMPRE em zero — o valor do body é ignorado (senão o client
      // "criaria dinheiro" abrindo conta com saldo). Movimentações ajustam via $inc.
      availableBalance: toDecimal128(0),
      predictedBalance: toDecimal128(0),
      // Conta nova nunca nasce como padrão: o padrão único do restaurante é gerido
      // exclusivamente pelo /:id/set-default (senão o body criaria um 2º default).
      isDefault: false,
    }

    try {
      const inserted = await super.insert(scopedItem as unknown as FinancialAccount & Document, ctx)
      return balancesToNumber(inserted as any) as FinancialAccount
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
    // FIX (isMultipleResponse): o HttpBaseClient.findAll() da mintly-lib sempre manda
    // isMultipleResponse=true na query, mas nenhum documento tem esse campo — se ele
    // vazasse pro filtro do Mongo, a listagem via client oficial sempre voltaria vazia.
    const { page = 1, size = 10, orderBy, orderDirection, createdAtDirection, isMultipleResponse, ...queryFilter } = filter

    // Clamp (igual à base): page >= 1 evita skip negativo (que estoura 500);
    // size entre 1 e 100 evita página gigante.
    const pageNum = Math.max(1, Math.floor(Number(page) || 1))
    const sizeNum = Math.min(100, Math.max(1, Math.floor(Number(size) || 10)))
    const skip = (pageNum - 1) * sizeNum

    // FIX (tenant scoping): nunca lista contas de outro restaurante. sanitizeFilter
    // remove chaves com operador Mongo ($where, $gt…) vindas de query param — sem
    // isso o override furava a proteção anti-NoSQL-injection da base (e divergia do count).
    const scopedFilter = { ...this.sanitizeFilter(queryFilter), restaurantId: ctx.restaurantId }

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

    return result.map(d => balancesToNumber(d as any)) as unknown as FinancialAccount[]
  }
}
