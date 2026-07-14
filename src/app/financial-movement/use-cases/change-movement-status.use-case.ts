import { ObjectId } from 'mongodb'
import { MovementStatus, MovementStatusSource } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { applyStatusTransition } from '../movement-status'
import { movementFromStorage } from '../financial-movement-repository'

const VALID = new Set<string>([MovementStatus.Pending, MovementStatus.Settled, MovementStatus.Cancelled])

/**
 * Altera o status de uma movimentação (MIN-68), corrigindo o saldo da conta na
 * MESMA transação: **reverte o efeito do status antigo + aplica o novo**.
 * Ex.: pending→settled move do saldo previsto p/ o disponível; →cancelled
 * reverte tudo. Registra em `history[]`.
 *
 * QUALQUER chamada aqui carimba `statusSource: 'manual'` — inclusive a que
 * reafirma o status atual (trava contra o settler). Quem tem a palavra final é
 * o dono.
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

        // P1 — reafirmar o status ATUAL também é ação humana: é assim que o dono
        // TRAVA o movimento (ex.: sabe que o repasse do iFood não vai cair na data
        // e faz PATCH { status: 'pending' } para o settler não liquidá-lo). Antes
        // isto era um no-op silencioso: 200, `statusSource` continuava `auto` e o
        // settler liquidava na data assim mesmo. Carimba `manual` + auditoria, mas
        // NÃO toca no saldo — o status não mudou, não há impacto a reverter/aplicar.
        if (String(mov.status) === newStatus) {
          const now = new Date()
          const actor = ctx.userId ?? 'system'
          await movements.updateOne(
            { _id: mov._id, restaurantId: ctx.restaurantId },
            {
              $set: {
                statusSource: MovementStatusSource.Manual,
                'audit.updatedAt': now,
                'audit.updatedBy': actor,
              },
              $push: {
                history: { at: now, by: actor, action: `status:lock:${newStatus}` },
              } as any,
            },
            { session },
          )
          updated = movementFromStorage({ ...mov, statusSource: MovementStatusSource.Manual } as any)
          return
        }

        // P1 — ação HUMANA carimba `manual`: trava permanente, o settler nunca mais
        // reavalia este movimento por data. Quem tem a palavra final é o dono.
        await applyStatusTransition({
          movements,
          accounts,
          movement: mov,
          newStatus,
          actor: ctx.userId ?? 'system',
          statusSource: MovementStatusSource.Manual,
          session,
          now: new Date(),
        })

        updated = movementFromStorage({ ...mov, status: newStatus, statusSource: MovementStatusSource.Manual } as any)
      })

      return updated
    } finally {
      await session.endSession()
    }
  }
}
