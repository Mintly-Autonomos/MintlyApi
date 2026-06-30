import { Collection, ObjectId, ClientSession } from 'mongodb'
import { toDecimal128 } from '../../core/money/money'
import { BalanceImpact } from './movement-rules'

/**
 * Aplica (ou reverte) o impacto de uma movimentação no saldo da conta, via
 * `$inc` Decimal128 — dentro da transação. `sign = 1` aplica; `sign = -1`
 * reverte. Sem bucket (cancelled) é no-op.
 */
export async function applyBalanceImpact (
  accounts: Collection<any>,
  accountId: ObjectId,
  impact: BalanceImpact,
  sign: 1 | -1,
  session: ClientSession,
  now: Date,
): Promise<void> {
  if (!impact.bucket) return
  const field = impact.bucket === 'available' ? 'availableBalance' : 'predictedBalance'
  await accounts.updateOne(
    { _id: accountId },
    { $inc: { [field]: toDecimal128(impact.delta * sign) }, $set: { 'audit.updatedAt': now } },
    { session },
  )
}
