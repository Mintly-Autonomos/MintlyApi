import { Collection, ObjectId, ClientSession } from 'mongodb'
import { centsToDecimal128, toCents, toDecimal128 } from '../../core/money/money'
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

/**
 * Versão em lote de `applyBalanceImpact` (importação): soma os impactos de várias movimentações por
 * conta — em centavos inteiros, sem passar por float — e faz UM `$inc` por conta, em vez de um por
 * movimentação. O resultado no saldo é o mesmo de aplicar um a um. Mesmas garantias: escopado por
 * `restaurantId` e falha alto se a conta não existir.
 */
export async function applyBalanceImpacts (
  accounts: Collection<any>,
  entries: { accountId: ObjectId; impact: BalanceImpact }[],
  restaurantId: string | undefined,
  session: ClientSession,
  now: Date,
): Promise<void> {
  const perAccount = new Map<string, { accountId: ObjectId; availableBalance: number; predictedBalance: number }>()
  for (const { accountId, impact } of entries) {
    if (!impact.bucket) continue
    const key = String(accountId)
    const sums = perAccount.get(key) ?? { accountId, availableBalance: 0, predictedBalance: 0 }
    sums[impact.bucket === 'available' ? 'availableBalance' : 'predictedBalance'] += toCents(impact.delta)
    perAccount.set(key, sums)
  }

  for (const { accountId, availableBalance, predictedBalance } of perAccount.values()) {
    const inc: Record<string, ReturnType<typeof centsToDecimal128>> = {}
    if (availableBalance !== 0) inc.availableBalance = centsToDecimal128(availableBalance)
    if (predictedBalance !== 0) inc.predictedBalance = centsToDecimal128(predictedBalance)
    const update: Record<string, unknown> = { $set: { 'audit.updatedAt': now } }
    if (Object.keys(inc).length > 0) update.$inc = inc
    const res = await accounts.updateOne({ _id: accountId, restaurantId }, update, { session })
    if (res.matchedCount === 0) {
      throw new NotFoundError(Resource.FinancialAccount, String(accountId))
    }
  }
}
