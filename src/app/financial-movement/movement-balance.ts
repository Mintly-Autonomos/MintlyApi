import { Collection, ObjectId, ClientSession } from 'mongodb'
import { toDecimal128 } from '../../core/money/money'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { BalanceImpact } from './movement-rules'

/**
 * Aplica (ou reverte) o impacto de uma movimentação no saldo da conta, via
 * `$inc` Decimal128 — dentro da transação. `sign = 1` aplica; `sign = -1`
 * reverte. Sem bucket (cancelled) é no-op.
 *
 * O `$inc` é **escopado por `restaurantId`** (nunca toca conta de outro tenant)
 * e revalida a conta: se o filtro não casar nenhum doc (conta inexistente/de
 * outro tenant — ex.: conta ANTIGA apagada ao trocar de conta no update), falha
 * alto em vez de perder o ajuste silenciosamente (drift de saldo).
 */
export async function applyBalanceImpact (
  accounts: Collection<any>,
  accountId: ObjectId,
  restaurantId: string | undefined,
  impact: BalanceImpact,
  sign: 1 | -1,
  session: ClientSession,
  now: Date,
): Promise<void> {
  if (!impact.bucket) return
  const field = impact.bucket === 'available' ? 'availableBalance' : 'predictedBalance'
  const res = await accounts.updateOne(
    { _id: accountId, restaurantId },
    { $inc: { [field]: toDecimal128(impact.delta * sign) }, $set: { 'audit.updatedAt': now } },
    { session },
  )
  if (res.matchedCount === 0) {
    throw new NotFoundError(Resource.FinancialAccount, String(accountId))
  }
}
