import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource, buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { financialAccountInsertSchema, financialAccountUpdateSchema, FinancialAccount } from 'mintly-lib'
import { FinancialAccountRepository } from './financial-account-repository'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { SetDefaultAccountUseCase } from './use-cases/set-default-account.use-case'
import { InactivateAccountUseCase } from './use-cases/inactivate-account.use-case'
import { escapeRegex } from '../../core/util/escape-regex'
import { StatusCodes } from 'http-status-codes'
import { assertAccountUpdateAllowed, buildAccountChangeHistory, AccountUpdateChanges } from './account-rules'

export class FinancialAccountController extends CrudController<FinancialAccount, string> {
  constructor (
    // Guardado (diferente de antes): o update precisa ler o TIPO ARMAZENADO da conta
    // para validar a coerência platform ⇔ taxa/prazo (P5) — o PATCH parcial não traz
    // o `type`, e o schema não conhece o estado do banco.
    private readonly accountRepo: FinancialAccountRepository,
    // DI das use cases transacionais (mesmo padrão das demais rotas).
    private readonly setDefaultUseCase: SetDefaultAccountUseCase,
    private readonly inactivateUseCase: InactivateAccountUseCase,
  ) {
    // 3º argumento (ormPartial): schema parcial usado pelo update.
    // Sem ele, o CrudController valida o PATCH contra o schema COMPLETO e rejeita
    // updates parciais por falta de campos obrigatórios.
    super(
      accountRepo,
      financialAccountInsertSchema as any,
      financialAccountUpdateSchema as any,
      Resource.FinancialAccount,
    )
  }

  /**
   * PATCH /:id — guards de update:
   *  - `isDefault` não é editável aqui (rota própria: PATCH /:id/default).
   *  - `type` é imutável e taxa/prazo só existem em conta `platform` (P5) — regra
   *    pura em `account-rules.ts`, aplicada contra o tipo ARMAZENADO.
   */
  async update (id: string, item: Partial<FinancialAccount>, source?: ContextSource): Promise<ResponseStructure> {
    if (item.isDefault !== undefined) {
      throw new ConflictError('O campo isDefault não pode ser editado manualmente. Use a rota específica de SetDefault.')
    }

    const changes = item as AccountUpdateChanges
    const touchesTypeOrFee =
      changes.type !== undefined ||
      changes.feePercent !== undefined ||
      changes.settlementDays !== undefined
    const touchesHistoryFields = touchesTypeOrFee || item.name !== undefined || item.status !== undefined

    // Só vai ao banco quando o PATCH mexe em algo que a regra ou o histórico precisam comparar.
    let stored: any
    const ctx = buildRequestContext(source)
    if (touchesHistoryFields) {
      stored = await this.accountRepo.findById(id, ctx)
      if (!stored) {
        throw new NotFoundError(Resource.FinancialAccount, id)
      }
      if (touchesTypeOrFee) assertAccountUpdateAllowed(String(stored.type), changes)
    }

    const response = await super.update(id, item, source)

    // Histórico (nome, status, taxa, prazo): só depois do update validado e gravado.
    if (stored) {
      const entries = buildAccountChangeHistory(
        stored,
        { name: item.name, status: item.status, feePercent: changes.feePercent, settlementDays: changes.settlementDays },
        ctx.userId ?? 'system',
      )
      if (entries.length > 0) await this.accountRepo.appendHistory(id, entries, ctx)
    }

    return response
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
