import { ClientSession, Db, ObjectId } from 'mongodb'
import {
  financialMovementSchema, MovementDirection, MovementOrigin, MovementStatus, MovementStatusSource,
  PaymentMethod, SystemCategoryKey, transferSchema, openingBalanceSchema,
} from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { Resource } from '../../../core/types/resource'
import { movementFromStorage, movementToStorage } from '../financial-movement-repository'
import { balanceImpact } from '../movement-rules'
import { applyBalanceImpact } from '../movement-balance'
import { applyStatusTransition } from '../movement-status'
import { ensureSystemCategory } from '../system-categories'
import { toBusinessDate } from '../../reports/shared/period'

const accountRef = (a: any) => ({ _id: String(a._id), name: a.name, type: a.type })

async function loadActiveAccount (db: Db, ctx: RequestContext, id: string, session: ClientSession): Promise<any> {
  const acc = ObjectId.isValid(id)
    ? await db.collection('financial_accounts').findOne({ _id: new ObjectId(id), restaurantId: ctx.restaurantId }, { session })
    : null
  if (!acc) throw new NotFoundError(Resource.FinancialAccount, id)
  if (acc.status !== 'active') throw new ConflictError('Conta inativa não pode receber lançamentos financeiros.')
  return acc
}

/**
 * Lançamento de sistema já liquidado, sem taxa nem prazo (mesmo em conta de plataforma: tirar dinheiro do
 * iFood não paga a taxa do iFood de novo). Valida com o schema da lib e grava + ajusta o saldo.
 */
async function insertSystemMovement (p: {
  db: Db
  ctx: RequestContext
  session: ClientSession
  direction: MovementDirection
  title: string
  amount: number
  date: Date
  account: any
  category: any
  extra?: Record<string, unknown>
  description?: string
  now: Date
}): Promise<any> {
  const actor = p.ctx.userId ?? 'system'
  const doc: Record<string, any> = {
    restaurantId: p.ctx.restaurantId,
    direction: p.direction,
    title: p.title,
    status: MovementStatus.Settled,
    statusSource: MovementStatusSource.Manual,
    date: p.date,
    settledAt: p.date,
    grossValue: p.amount,
    feeValue: 0,
    netValue: p.amount,
    account: accountRef(p.account),
    category: { _id: String(p.category._id), name: p.category.name, type: p.category.type },
    paymentMethod: PaymentMethod.Transfer,
    origin: MovementOrigin.Manual,
    history: [{ at: p.now, by: actor, action: 'register' }],
    audit: { createdAt: p.now, updatedAt: p.now, createdBy: p.ctx.userId, updatedBy: p.ctx.userId },
    ...(p.extra ?? {}),
  }
  if (p.description) doc.description = p.description
  financialMovementSchema.parse(doc)
  const storage = movementToStorage(doc)
  const res = await p.db.collection('financial_movements').insertOne(storage as any, { session: p.session })
  const impact = balanceImpact({ direction: p.direction, status: MovementStatus.Settled, grossValue: p.amount, netValue: p.amount })
  await applyBalanceImpact(p.db.collection('financial_accounts'), p.account._id, p.ctx.restaurantId, impact, 1, p.session, p.now)
  return movementFromStorage({ ...(storage as any), _id: res.insertedId })
}

/**
 * Transferência entre contas do restaurante (S3.2): a saída na origem e a entrada no destino, na mesma
 * transação, ligadas pelo `transferId`. O caixa total não muda; cada conta fica com o saldo certo.
 */
export class TransferUseCase {
  async execute (body: unknown, ctx: RequestContext): Promise<{ transferId: string; out: any; in: any }> {
    const input = transferSchema.parse(body) as { fromAccountId: string; toAccountId: string; amount: number; date: Date; description?: string }
    if (input.fromAccountId === input.toAccountId) {
      throw new ValidationError('Escolha contas diferentes para a origem e o destino.')
    }
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    const db = connection.getDatabase(ctx.env)
    try {
      let result: { transferId: string; out: any; in: any } | null = null
      await session.withTransaction(async () => {
        const actor = ctx.userId ?? 'system'
        const from = await loadActiveAccount(db, ctx, input.fromAccountId, session)
        const to = await loadActiveAccount(db, ctx, input.toAccountId, session)
        const outCat = await ensureSystemCategory(db, ctx.restaurantId, SystemCategoryKey.TransferOut, session, actor)
        const inCat = await ensureSystemCategory(db, ctx.restaurantId, SystemCategoryKey.TransferIn, session, actor)
        const transferId = new ObjectId().toHexString()
        const date = toBusinessDate(input.date)
        const now = new Date()
        const out = await insertSystemMovement({
          db,
          ctx,
          session,
          now,
          date,
          direction: MovementDirection.Out,
          amount: input.amount,
          title: `Transferência para ${to.name}`,
          account: from,
          category: outCat,
          description: input.description,
          extra: { transferId, transferCounterpart: accountRef(to) },
        })
        const inn = await insertSystemMovement({
          db,
          ctx,
          session,
          now,
          date,
          direction: MovementDirection.In,
          amount: input.amount,
          title: `Transferência de ${from.name}`,
          account: to,
          category: inCat,
          description: input.description,
          extra: { transferId, transferCounterpart: accountRef(from) },
        })
        result = { transferId, out, in: inn }
      })
      return result!
    } finally {
      await session.endSession()
    }
  }
}

/**
 * Saldo inicial da conta (S3.2): uma entrada "Saldo inicial" na data informada. Substitui a anterior
 * (cancela e lança de novo), então não há saldo inicial duplicado. `amount` 0 só remove.
 */
export class OpeningBalanceUseCase {
  async execute (accountId: string, body: unknown, ctx: RequestContext): Promise<any | null> {
    const input = openingBalanceSchema.parse(body) as { amount: number; date: Date }
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    const db = connection.getDatabase(ctx.env)
    try {
      let created: any | null = null
      await session.withTransaction(async () => {
        const actor = ctx.userId ?? 'system'
        const account = await loadActiveAccount(db, ctx, accountId, session)
        const category = await ensureSystemCategory(db, ctx.restaurantId, SystemCategoryKey.OpeningBalance, session, actor)
        const movements = db.collection('financial_movements')
        const now = new Date()
        const previous = await movements.find({
          restaurantId: ctx.restaurantId,
          'account._id': String(account._id),
          'category._id': String(category._id),
          status: { $ne: MovementStatus.Cancelled },
        }, { session }).toArray()
        for (const mov of previous) {
          await applyStatusTransition({
            movements,
            accounts: db.collection('financial_accounts'),
            movement: mov,
            newStatus: MovementStatus.Cancelled,
            actor,
            statusSource: MovementStatusSource.Manual,
            session,
            now,
          })
        }
        if (input.amount > 0) {
          created = await insertSystemMovement({
            db,
            ctx,
            session,
            now,
            date: toBusinessDate(input.date),
            direction: MovementDirection.In,
            amount: input.amount,
            title: `Saldo inicial · ${account.name}`,
            account,
            category,
          })
        }
      })
      return created
    } finally {
      await session.endSession()
    }
  }
}
