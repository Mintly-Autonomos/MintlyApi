import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource } from '../../core/context/build-request-context'
import { ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { financialAccountSchema, FinancialAccount } from 'mintly-lib'
import { FinancialAccountRepository } from './financial-account-repository'

export class FinancialAccountController extends CrudController<FinancialAccount, string> {
  constructor (private readonly financialAccountRepo: FinancialAccountRepository) {
    // Passamos o repositório específico e o validador de runtime para a classe pai
    super(financialAccountRepo, financialAccountSchema as any)
  }

  /**
   * "isDefault não editável pelo update genérico"
   */
  async update (id: string, item: Partial<FinancialAccount>, source?: ContextSource): Promise<ResponseStructure> {
    if (item.isDefault !== undefined) {
      throw new Error('BAD_REQUEST: O campo isDefault não pode ser editado manualmente. Use a rota específica de SetDefault.')
    }

    return super.update(id, item, source)
  }

  /**
   * Busca textual por name e filtros
   */
  async findAll (filter: any, source?: ContextSource): Promise<ResponseStructure> {
    if (filter.name) {
      filter.name = { $regex: filter.name, $options: 'i' }
    }

    return super.findAll(filter, source)
  }
}
