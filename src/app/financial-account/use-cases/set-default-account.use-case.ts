import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { FinancialAccountRepository } from '../financial-account-repository'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'

export class SetDefaultAccountUseCase {
  constructor (private readonly repo: FinancialAccountRepository = new FinancialAccountRepository()) {}

  async execute (id: string, ctx: RequestContext): Promise<void> {
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()

    try {
      await session.withTransaction(async () => {
        // 1. Buscar a conta solicitada (Garantindo isolamento de restaurante)
        const targetAccount = await this.repo.find(
          { _id: id as any, restaurantId: ctx.restaurantId },
          ctx,
          { session },
        )

        if (!targetAccount) {
          throw new NotFoundError(Resource.FinancialAccount, id)
        }

        if ((targetAccount as any).isDefault === true) {
          return
        }

        if ((targetAccount as any).status === 'inactive') {
          throw new ConflictError('Não é possível definir uma conta inativa como padrão.')
        }

        // 2. Buscar conta padrão atual do restaurante
        const currentDefault = await this.repo.find(
          { isDefault: true, restaurantId: ctx.restaurantId },
          ctx,
          { session },
        )

        // history[].at é s.date() (Date) no schema — gravamos Date real, não string ISO.
        const historyEntry = {
          at: new Date(),
          by: ctx.userId ?? 'system',
          action: 'set-default',
        }

        // 3. Se houver uma conta padrão diferente, desativar
        if (currentDefault && String(currentDefault._id) !== id) {
          const oldHistory = Array.isArray((currentDefault as any).history)
            ? [...(currentDefault as any).history]
            : []

          oldHistory.push({ ...historyEntry, action: 'unset-default' })

          await this.repo.update(
            String(currentDefault._id),
            { isDefault: false, history: oldHistory } as any,
            ctx,
            { session },
          )
        }

        // 4. Definir a nova conta como padrão
        const newHistory = Array.isArray((targetAccount as any).history)
          ? [...(targetAccount as any).history]
          : []

        newHistory.push(historyEntry)

        await this.repo.update(
          id,
          { isDefault: true, history: newHistory } as any,
          ctx,
          { session },
        )
      })
    } finally {
      await session.endSession()
    }
  }
}