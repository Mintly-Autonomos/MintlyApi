import { ObjectId } from 'mongodb'
import { MovementStatus } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { balanceImpact } from '../movement-rules'
import { applyBalanceImpact } from '../movement-balance'
import { movementFromStorage } from '../financial-movement-repository'

const VALID = new Set<string>([MovementStatus.Pending, MovementStatus.Settled, MovementStatus.Cancelled])

/**
 * Altera o status de uma movimentação (MIN-68), corrigindo o saldo da conta na
 * MESMA transação: **reverte o efeito do status antigo + aplica o novo**.
 * Ex.: pending→settled move do saldo previsto p/ o disponível; →cancelled
 * reverte tudo. Registra em `history[]`.
 */
export class ChangeMovementStatusUseCase {
  async execute (movementId: string, newStatus: string, ctx: RequestContext): Promise<any> {
    if (!VALID.has(newStatus)) {
      throw new ConflictError(`Status inválido: ${newStatus}.`)
    }
    if (!ObjectId.isValid(movementId)) {
      throw new NotFoundError(Resource.FinancialMovement, movementId)
    }

    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    const db = connection.getDatabase(ctx.env)

    try {
      let updated: any
      await session.withTransaction(async () => {
        const movements = db.collection('financial_movements')
        const accounts = db.collection('financial_accounts')

        const mov = await movements.findOne(
          { _id: new ObjectId(movementId), restaurantId: ctx.restaurantId },
          { session },
        )
        if (!mov) throw new NotFoundError(Resource.FinancialMovement, movementId)

        const oldStatus = mov.status as string
        if (oldStatus === newStatus) {
          updated = movementFromStorage(mov as any)
          return
        }

        const gross = Number((mov.grossValue ?? 0).toString())
        const net = Number((mov.netValue ?? 0).toString())
        const now = new Date()
        const accountId = new ObjectId(String(mov.account._id))

        // Reverte o efeito do status atual e aplica o do novo status.
        const oldImpact = balanceImpact({ direction: mov.direction, status: oldStatus as any, grossValue: gross, netValue: net })
        const newImpact = balanceImpact({ direction: mov.direction, status: newStatus as any, grossValue: gross, netValue: net })
        await applyBalanceImpact(accounts, accountId, ctx.restaurantId, oldImpact, -1, session, now)
        await applyBalanceImpact(accounts, accountId, ctx.restaurantId, newImpact, 1, session, now)

        const historyEntry = { at: now, by: ctx.userId ?? 'system', action: `status:${oldStatus}->${newStatus}` }

        await movements.updateOne(
          { _id: mov._id },
          {
            $set: { status: newStatus, 'audit.updatedAt': now, 'audit.updatedBy': ctx.userId },
            $push: { history: historyEntry } as any,
          },
          { session },
        )

        updated = movementFromStorage({ ...mov, status: newStatus } as any)
      })

      return updated
    } finally {
      await session.endSession()
    }
  }
}
