import { Collection, ObjectId, ClientSession } from 'mongodb'
import { MovementStatusSource } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { balanceImpact } from './movement-rules'
import { applyBalanceImpact } from './movement-balance'

const num = (v: any): number => Number((v ?? 0).toString())

export interface StatusTransitionParams {
  movements: Collection<any>
  accounts: Collection<any>
  /** Documento JÁ lido dentro da sessão. */
  movement: any
  newStatus: string
  /** Quem está agindo: `ctx.userId` ou 'system' (settler). */
  actor: string
  statusSource: MovementStatusSource
  session: ClientSession
  now: Date
}

/**
 * Troca o status de uma movimentação e corrige o saldo da conta na MESMA
 * transação: **reverte o impacto do status antigo + aplica o do novo**.
 * Fonte única dessa regra — usada pelo PATCH /:id/status (humano) e pelo
 * settler por data (P1).
 *
 * **Guard-first (idempotência):** o `updateOne` do movimento vem ANTES das
 * escritas de saldo e filtra pelo status ANTIGO. Se outro processo já tiver
 * mudado o status (duas rodadas concorrentes do settler, ou o dono mexendo ao
 * mesmo tempo), o filtro não casa, lançamos e a transação aborta — sem ter
 * tocado no saldo. A ordem inversa (saldo primeiro) causaria drift.
 */
export async function applyStatusTransition (p: StatusTransitionParams): Promise<void> {
  const { movements, accounts, movement, newStatus, actor, statusSource, session, now } = p

  const oldStatus = String(movement.status)
  const restaurantId = movement.restaurantId as string | undefined

  const res = await movements.updateOne(
    { _id: movement._id, restaurantId, status: oldStatus },
    {
      $set: {
        status: newStatus,
        statusSource,
        'audit.updatedAt': now,
        'audit.updatedBy': actor,
      },
      $push: {
        history: { at: now, by: actor, action: `status:${oldStatus}->${newStatus}` },
      } as any,
    },
    { session },
  )

  if (res.matchedCount === 0) {
    throw new ConflictError('O status da movimentação mudou concorrentemente; a operação foi abortada.')
  }

  const gross = num(movement.grossValue)
  const net = num(movement.netValue)
  const accountId = new ObjectId(String(movement.account._id))

  const oldImpact = balanceImpact({ direction: movement.direction, status: oldStatus as any, grossValue: gross, netValue: net })
  const newImpact = balanceImpact({ direction: movement.direction, status: newStatus as any, grossValue: gross, netValue: net })

  await applyBalanceImpact(accounts, accountId, restaurantId, oldImpact, -1, session, now)
  await applyBalanceImpact(accounts, accountId, restaurantId, newImpact, 1, session, now)
}
