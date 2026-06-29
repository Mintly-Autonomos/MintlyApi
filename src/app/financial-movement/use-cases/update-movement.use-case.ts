import { ObjectId } from 'mongodb'
import { financialMovementSchema } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { computeSnapshot, balanceImpact } from '../movement-rules'
import { applyBalanceImpact } from '../movement-balance'
import { movementToStorage, movementFromStorage } from '../financial-movement-repository'

export interface UpdateMovementInput {
  title?: string
  grossValue?: number
  date?: string | Date
  paymentMethod?: string
  status?: string
  accountId?: string
  categoryId?: string
  counterparty?: { name: string; kind: string; refId?: string }
  fiscalNote?: string
  description?: string
}

const num = (v: any): number => Number((v ?? 0).toString())

/**
 * Edita uma movimentação (MIN-68). Alterações em valor/conta/status (e demais
 * campos) recalculam fee/net/data-prevista e corrigem o saldo na MESMA
 * transação: **reverte o efeito antigo (na conta antiga) + aplica o novo (na
 * conta nova)** — retroativo resolve sozinho. `direction` é imutável.
 */
export class UpdateMovementUseCase {
  async execute (movementId: string, changes: UpdateMovementInput, ctx: RequestContext): Promise<any> {
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
        const categories = db.collection('financial_categories')

        const mov = await movements.findOne(
          { _id: new ObjectId(movementId), restaurantId: ctx.restaurantId },
          { session },
        )
        if (!mov) throw new NotFoundError(Resource.FinancialMovement, movementId)

        const direction = mov.direction as string // imutável
        const oldAccountId = String(mov.account._id)
        const newAccountId = changes.accountId ?? oldAccountId

        // Conta nova (viva) — necessária p/ recalcular fee/net e snapshot.
        if (!ObjectId.isValid(newAccountId)) throw new NotFoundError(Resource.FinancialAccount, newAccountId)
        const account = await accounts.findOne({ _id: new ObjectId(newAccountId), restaurantId: ctx.restaurantId }, { session })
        if (!account) throw new NotFoundError(Resource.FinancialAccount, newAccountId)
        if (changes.accountId && changes.accountId !== oldAccountId && account.status !== 'active') {
          throw new ConflictError('Conta inativa não pode receber lançamentos financeiros.')
        }

        // Categoria nova (viva), se trocada.
        let categorySnap = mov.category
        if (changes.categoryId) {
          if (!ObjectId.isValid(changes.categoryId)) throw new NotFoundError(Resource.FinancialCategory, changes.categoryId)
          const cat = await categories.findOne({ _id: new ObjectId(changes.categoryId), restaurantId: ctx.restaurantId }, { session })
          if (!cat) throw new NotFoundError(Resource.FinancialCategory, changes.categoryId)
          categorySnap = { _id: String(cat._id), name: cat.name, type: cat.type }
        }

        const newGross = changes.grossValue ?? num(mov.grossValue)
        const newDate = changes.date ? new Date(changes.date) : new Date(mov.date)
        const newStatus = changes.status ?? mov.status
        const snapshot = computeSnapshot({ direction: direction as any, grossValue: newGross, date: newDate, account: account as any })

        const now = new Date()
        const history = Array.isArray(mov.history) ? [...mov.history] : []
        history.push({ at: now, by: ctx.userId ?? 'system', action: 'update' })

        // Documento reconstruído (preserva imutáveis + history + audit.createdAt).
        const newDoc: Record<string, any> = {
          restaurantId: ctx.restaurantId,
          direction,
          title: changes.title ?? mov.title,
          status: newStatus,
          date: newDate,
          grossValue: newGross,
          feeValue: snapshot.feeValue,
          netValue: snapshot.netValue,
          account: { _id: String(account._id), name: account.name, type: account.type },
          category: categorySnap,
          paymentMethod: changes.paymentMethod ?? mov.paymentMethod,
          origin: mov.origin,
          history,
          audit: {
            createdAt: mov.audit?.createdAt ?? now,
            createdBy: mov.audit?.createdBy,
            updatedAt: now,
            updatedBy: ctx.userId,
          },
        }
        if (snapshot.feePercentApplied != null) newDoc.feePercentApplied = snapshot.feePercentApplied
        if (snapshot.settlementDaysApplied != null) newDoc.settlementDaysApplied = snapshot.settlementDaysApplied
        if (snapshot.predictedReceiptDate != null) newDoc.predictedReceiptDate = snapshot.predictedReceiptDate
        const counterparty = changes.counterparty ?? mov.counterparty
        if (counterparty) newDoc.counterparty = counterparty
        const fiscalNote = changes.fiscalNote ?? mov.fiscalNote
        if (fiscalNote) newDoc.fiscalNote = fiscalNote
        const description = changes.description ?? mov.description
        if (description) newDoc.description = description

        // Validação Sapphire do doc resultante (categoria×direção, limites...).
        financialMovementSchema.parse(newDoc)

        // Correção de saldo: reverte o efeito antigo na conta ANTIGA, aplica o novo na NOVA.
        const oldImpact = balanceImpact({ direction: direction as any, status: mov.status, grossValue: num(mov.grossValue), netValue: num(mov.netValue) })
        const newImpact = balanceImpact({ direction: direction as any, status: newStatus, grossValue: newGross, netValue: snapshot.netValue })
        await applyBalanceImpact(accounts, new ObjectId(oldAccountId), oldImpact, -1, session, now)
        await applyBalanceImpact(accounts, new ObjectId(newAccountId), newImpact, 1, session, now)

        const storageDoc = movementToStorage(newDoc)
        await movements.replaceOne({ _id: mov._id }, storageDoc as any, { session })

        updated = movementFromStorage({ ...(storageDoc as any), _id: mov._id })
      })

      return updated
    } finally {
      await session.endSession()
    }
  }
}
