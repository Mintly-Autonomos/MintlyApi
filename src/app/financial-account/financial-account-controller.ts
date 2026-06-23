import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { financialAccountSchema, FinancialAccount } from 'mintly-lib'
import { FinancialAccountRepository } from './financial-account-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { SetDefaultAccountUseCase } from './use-cases/set-default-account.use-case'
import { StatusCodes } from 'http-status-codes'

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
      // O escudo do sistema reconhece essa classe e libera a mensagem!
      throw new ConflictError('O campo isDefault não pode ser editado manualmente. Use a rota específica de SetDefault.')
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

  async setDefault (request: any, reply: any) {
    const { id } = request.params

    // Na nossa arquitetura (como visto nas outras rotas), o próprio request costuma servir como source
    // O Use Case precisa do ContextSource (que contém o restaurantId)
    const setDefaultUseCase = new SetDefaultAccountUseCase()
    await setDefaultUseCase.execute(id, request)

    // Usa o builder de resposta padrão da sua base
    return new ResponseBuilder()
      .response(reply)
      .status(StatusCodes.OK) // Ou 200/204
      .payload({ message: 'Conta definida como padrão com sucesso.' })
      .build()
  }
}
