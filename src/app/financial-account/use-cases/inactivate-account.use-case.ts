import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { FinancialAccountRepository } from '../financial-account-repository'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'

export class InactivateAccountUseCase {
  constructor (private readonly repo: FinancialAccountRepository = new FinancialAccountRepository()) {}

  /**
   * Inativa uma conta financeira de forma transacional (MIN-65).
   *
   * Guards (409 ConflictError com motivo):
   *  - saldo disponível diferente de zero
   *  - saldo previsto diferente de zero
   *  - é a única conta ativa do restaurante
   *  - é a conta padrão e nenhuma substituta foi informada
   *
   * Quando a conta inativada é a padrão, a substituta (replacementDefaultId)
   * passa a ser a nova padrão DENTRO da mesma transação.
   *
   * @param id ID da conta a inativar
   * @param ctx Contexto da requisição (tenant + autor)
   * @param replacementDefaultId ID da conta que assume o padrão, se a alvo for padrão
   */
  async execute (id: string, ctx: RequestContext, replacementDefaultId?: string): Promise<void> {
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()

    try {
      await session.withTransaction(async () => {
        // 1. Buscar a conta solicitada (isolando por restaurante)
        const targetAccount = await this.repo.find(
          { _id: id as any, restaurantId: ctx.restaurantId },
          ctx,
          { session },
        )

        if (!targetAccount) {
          throw new NotFoundError(Resource.FinancialAccount, id)
        }

        // Idempotência: se já está inativa, não há nada a fazer
        if ((targetAccount as any).status === 'inactive') {
          return
        }

        // 2. Guard — saldo disponível diferente de zero
        const availableBalance = Number((targetAccount as any).availableBalance ?? 0)
        if (availableBalance !== 0) {
          throw new ConflictError('Não é possível inativar uma conta com saldo disponível diferente de zero.')
        }

        // 3. Guard — saldo previsto diferente de zero
        const predictedBalance = Number((targetAccount as any).predictedBalance ?? 0)
        if (predictedBalance !== 0) {
          throw new ConflictError('Não é possível inativar uma conta com saldo previsto diferente de zero.')
        }

        // 4. Guard — única conta ativa do restaurante
        // Procuramos QUALQUER outra conta ativa (excluindo a própria pelo _id real armazenado).
        const otherActiveAccount = await this.repo.find(
          {
            status: 'active',
            restaurantId: ctx.restaurantId,
            _id: { $ne: (targetAccount as any)._id },
          } as any,
          ctx,
          { session },
        )

        if (!otherActiveAccount) {
          throw new ConflictError('Não é possível inativar a única conta ativa do restaurante.')
        }

        // history[].at é s.date() (Date) no schema — gravamos Date real, não string ISO.
        const historyEntry = {
          at: new Date(),
          by: ctx.userId ?? 'system',
          action: 'inactivate',
        }

        // 5. Se a conta é a padrão, exigir e validar a substituta
        let replacement: any = null

        if ((targetAccount as any).isDefault === true) {
          if (!replacementDefaultId) {
            throw new ConflictError('A conta padrão não pode ser inativada sem a definição de uma nova conta padrão.')
          }

          if (replacementDefaultId === id) {
            throw new ConflictError('A nova conta padrão não pode ser a própria conta sendo inativada.')
          }

          replacement = await this.repo.find(
            { _id: replacementDefaultId as any, restaurantId: ctx.restaurantId },
            ctx,
            { session },
          )

          if (!replacement) {
            throw new NotFoundError(Resource.FinancialAccount, replacementDefaultId)
          }

          if (replacement.status !== 'active') {
            throw new ConflictError('A nova conta padrão deve estar ativa.')
          }
        }

        // 6. Inativar a conta-alvo (e remover o padrão) ANTES de promover a substituta.
        // Ordem importa: o índice unique parcial {restaurantId} where isDefault:true
        // não pode ver duas contas padrão simultaneamente, nem por um instante.
        const targetHistory = Array.isArray((targetAccount as any).history)
          ? [...(targetAccount as any).history]
          : []

        targetHistory.push(historyEntry)

        await this.repo.update(
          id,
          { status: 'inactive', isDefault: false, history: targetHistory } as any,
          ctx,
          { session },
        )

        // 7. Promover a substituta a padrão (somente quando havia padrão a transferir)
        if (replacement) {
          const replacementHistory = Array.isArray(replacement.history)
            ? [...replacement.history]
            : []

          replacementHistory.push({ ...historyEntry, action: 'set-default' })

          await this.repo.update(
            String(replacement._id),
            { isDefault: true, history: replacementHistory } as any,
            ctx,
            { session },
          )
        }
      })
    } finally {
      await session.endSession()
    }
  }
}

