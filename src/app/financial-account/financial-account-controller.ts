import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource, buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { financialAccountInsertSchema, financialAccountUpdateSchema, FinancialAccount } from 'mintly-lib'
import { FinancialAccountRepository } from './financial-account-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { Resource } from '../../core/types/resource'
import { SetDefaultAccountUseCase } from './use-cases/set-default-account.use-case'
import { InactivateAccountUseCase } from './use-cases/inactivate-account.use-case'
import { escapeRegex } from '../../core/util/escape-regex'
import { StatusCodes } from 'http-status-codes'

export class FinancialAccountController extends CrudController<FinancialAccount, string> {
  constructor (
    // Sem `private readonly`: o repo só alimenta o super (o CrudController pai é quem o usa).
    financialAccountRepo: FinancialAccountRepository,
    // DI das use cases transacionais (mesmo padrão das demais rotas).
    private readonly setDefaultUseCase: SetDefaultAccountUseCase,
    private readonly inactivateUseCase: InactivateAccountUseCase,
  ) {
    // 3º argumento (ormPartial): schema parcial usado pelo update.
    // Sem ele, o CrudController valida o PATCH contra o schema COMPLETO e rejeita
    // updates parciais por falta de campos obrigatórios.
    super(
      financialAccountRepo,
      financialAccountInsertSchema as any,
      financialAccountUpdateSchema as any,
      Resource.FinancialAccount,
    )
  }

  /**
   * "isDefault não editável pelo update genérico"
   */
  async update (id: string, item: Partial<FinancialAccount>, source?: ContextSource): Promise<ResponseStructure> {
    if (item.isDefault !== undefined) {
      throw new ConflictError('O campo isDefault não pode ser editado manualmente. Use a rota específica de SetDefault.')
    }

    return super.update(id, item, source)
  }

  /**
   * Busca textual por name e filtros
   */
  async findAll (filter: any, source?: ContextSource): Promise<ResponseStructure> {
    if (filter.name) {
      // Escapa o input antes de montar o $regex (continua "contém", case-insensitive)
      filter.name = { $regex: escapeRegex(String(filter.name)), $options: 'i' }
    }

    return super.findAll(filter, source)
  }

  /**
   * Define a conta padrão (use case transacional).
   */
  async setDefault (request: any, reply: any) {
    const { id } = request.params

    const ctx = buildRequestContext(request)
    await this.setDefaultUseCase.execute(id, ctx)

    return new ResponseBuilder()
      .status(StatusCodes.OK)
      .payload({ message: 'Conta definida como padrão com sucesso.' })
      .send(reply)
  }

  /**
   * Inativa a conta (use case transacional com guards).
   * body opcional: { replacementDefaultId?: string } — exigido pela use case
   * quando a conta-alvo for a padrão.
   */
  async inactivate (request: any, reply: any) {
    const { id } = request.params
    const { replacementDefaultId } = (request.body ?? {}) as { replacementDefaultId?: string }

    const ctx = buildRequestContext(request)
    await this.inactivateUseCase.execute(id, ctx, replacementDefaultId)

    return new ResponseBuilder()
      .status(StatusCodes.OK)
      .payload({ message: 'Conta inativada com sucesso.' })
      .send(reply)
  }
}
