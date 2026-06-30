import { ObjectId } from 'mongodb'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { Resource } from '../../../core/types/resource'
import { balanceImpact } from '../movement-rules'
import { toCents, fromCents, centsToDecimal128 } from '../../../core/money/money'

const num = (v: any): number => Number((v ?? 0).toString())

/**
 * Reconciliação (MIN-68): recalcula `availableBalance`/`predictedBalance` da
 * conta a partir de TODAS as suas movimentações (rede de segurança contra
 * divergência). Soma em centavos inteiros (exato) e grava como Decimal128.
 */
export class RecomputeBalancesUseCase {
  async execute (accountId: string, ctx: RequestContext): Promise<{ availableBalance: number; predictedBalance: number }> {
    if (!ObjectId.isValid(accountId)) {
      throw new NotFoundError(Resource.FinancialAccount, accountId)
    }

    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    const db = connection.getDatabase(ctx.env)

    try {
      let result = { availableBalance: 0, predictedBalance: 0 }
      await session.withTransaction(async () => {
        const accounts = db.collection('financial_accounts')
        const movements = db.collection('financial_movements')

        const account = await accounts.findOne({ _id: new ObjectId(accountId), restaurantId: ctx.restaurantId }, { session })
        if (!account) throw new NotFoundError(Resource.FinancialAccount, accountId)

        const movs = await movements.find(
          { restaurantId: ctx.restaurantId, 'account._id': accountId },
          { session },
        ).toArray()

        let availableCents = 0
        let predictedCents = 0
        for (const mov of movs) {
          const impact = balanceImpact({
            direction: mov.direction,
            status: mov.status,
            grossValue: num(mov.grossValue),
            netValue: num(mov.netValue),
          })
          if (impact.bucket === 'available') availableCents += toCents(impact.delta)
          else if (impact.bucket === 'predicted') predictedCents += toCents(impact.delta)
        }

        const now = new Date()
        await accounts.updateOne(
          { _id: account._id },
          {
            $set: {
              availableBalance: centsToDecimal128(availableCents),
              predictedBalance: centsToDecimal128(predictedCents),
              'audit.updatedAt': now,
            },
          },
          { session },
        )

        result = { availableBalance: fromCents(availableCents), predictedBalance: fromCents(predictedCents) }
      })

      return result
    } finally {
      await session.endSession()
    }
  }
}
