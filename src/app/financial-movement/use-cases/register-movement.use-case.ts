import { ObjectId } from 'mongodb'
import { financialMovementSchema, MovementDirection, MovementOrigin, MovementStatusSource } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { FinancialMovementRepository, movementToStorage, movementFromStorage } from '../financial-movement-repository'
import { computeSnapshot, defaultStatus, balanceImpact, resolveDueDate, resolveSettledAt } from '../movement-rules'
import { applyBalanceImpact } from '../movement-balance'

export interface RegisterMovementInput {
  direction: MovementDirection
  title: string
  grossValue: number
  date: string | Date
  /** Vencimento informado pelo dono. Em conta `platform`, o sistema calcula quando ausente. */
  dueDate?: string | Date
  accountId: string
  categoryId: string
  paymentMethod: string
  status?: string
  counterparty?: { name: string; kind: string; refId?: string }
  fiscalNote?: string
  description?: string
  origin?: string
  confirmDuplicate?: boolean
}

/**
 * Registra uma movimentação (entrada ou saída) e ajusta o saldo da conta na
 * MESMA transação (MIN-49/50). Busca conta (ativa) + categoria vivas para o
 * snapshot (Extended Reference); calcula fee/net/vencimento; status default pela
 * presença do vencimento; bloqueia duplicidade (<2min) salvo `confirmDuplicate`.
 */
export class RegisterMovementUseCase {
  constructor (private readonly movementRepo: FinancialMovementRepository = new FinancialMovementRepository()) {}

  async execute (input: RegisterMovementInput, ctx: RequestContext): Promise<any> {
    const connection = MongoDBConnection.getInstance()
    const session = connection.getClient().startSession()
    const db = connection.getDatabase(ctx.env)

    try {
      let created: any
      await session.withTransaction(async () => {
        const accounts = db.collection('financial_accounts')
        const categories = db.collection('financial_categories')
        const movements = db.collection('financial_movements')

        // 1. Conta viva (tenant-scoped) — precisa estar ativa.
        if (!ObjectId.isValid(input.accountId)) {
          throw new NotFoundError(Resource.FinancialAccount, input.accountId)
        }
        const account = await accounts.findOne(
          { _id: new ObjectId(input.accountId), restaurantId: ctx.restaurantId },
          { session },
        )
        if (!account) throw new NotFoundError(Resource.FinancialAccount, input.accountId)
        if (account.status !== 'active') {
          throw new ConflictError('Conta inativa não pode receber lançamentos financeiros.')
        }

        // 2. Categoria viva (tenant-scoped).
        if (!ObjectId.isValid(input.categoryId)) {
          throw new NotFoundError(Resource.FinancialCategory, input.categoryId)
        }
        const category = await categories.findOne(
          { _id: new ObjectId(input.categoryId), restaurantId: ctx.restaurantId },
          { session },
        )
        if (!category) throw new NotFoundError(Resource.FinancialCategory, input.categoryId)

        // 3. Cálculos de domínio.
        const date = new Date(input.date)
        const snapshot = computeSnapshot({
          direction: input.direction,
          grossValue: input.grossValue,
          date,
          account: account as any,
        })
        // M1 — vencimento: o informado pelo dono manda; senão vale o calculado
        // pela conta com prazo. Sem nenhum dos dois, é à vista.
        const dueDate = resolveDueDate({
          informed: input.dueDate != null ? new Date(input.dueDate) : undefined,
          computed: snapshot.dueDate,
          storedWasComputed: false,
        })

        const status = input.status ?? defaultStatus({ dueDate })
        const now = new Date()

        // Nasce `auto`: o settler pode liquidá-lo na data. Só vira `manual` se um
        // humano mexer no status depois, pelo PATCH /:id/status. Um status
        // explícito AQUI não carimba manual de propósito — um front que reenvia o
        // formulário inteiro mandaria o status junto e travaria o settler em tudo.
        const statusSource = MovementStatusSource.Auto

        // 4. Documento (snapshots de account/category; campos computados).
        const doc: Record<string, any> = {
          restaurantId: ctx.restaurantId,
          direction: input.direction,
          title: input.title,
          status,
          statusSource,
          date,
          grossValue: input.grossValue,
          feeValue: snapshot.feeValue,
          netValue: snapshot.netValue,
          account: { _id: String(account._id), name: account.name, type: account.type },
          category: { _id: String(category._id), name: category.name, type: category.type },
          paymentMethod: input.paymentMethod,
          origin: input.origin ?? MovementOrigin.Manual,
          history: [{ at: now, by: ctx.userId ?? 'system', action: 'register' }],
          audit: { createdAt: now, updatedAt: now, createdBy: ctx.userId, updatedBy: ctx.userId },
        }
        if (snapshot.feePercentApplied != null) doc.feePercentApplied = snapshot.feePercentApplied
        if (snapshot.settlementDaysApplied != null) doc.settlementDaysApplied = snapshot.settlementDaysApplied
        if (dueDate != null) doc.dueDate = dueDate
        // À vista: o dinheiro mexeu na data do lançamento, não na hora do cadastro.
        const settledAt = resolveSettledAt({ newStatus: status, fallback: date })
        if (settledAt != null) doc.settledAt = settledAt
        if (input.counterparty) doc.counterparty = input.counterparty
        if (input.fiscalNote) doc.fiscalNote = input.fiscalNote
        if (input.description) doc.description = input.description

        // 5. Validação Sapphire (categoria×direção, limites, grossValue>0...) -> 400.
        financialMovementSchema.parse(doc)

        // 6. Duplicidade (<2min) — bloqueia salvo confirmação explícita.
        if (!input.confirmDuplicate) {
          const dup = await this.movementRepo.findDuplicate(
            { accountId: doc.account._id, title: input.title, grossValue: input.grossValue, date },
            ctx,
            session,
          )
          if (dup) {
            throw new ConflictError('Possível movimentação duplicada nos últimos 2 minutos. Reenvie com confirmDuplicate=true para confirmar.')
          }
        }

        // 7. Persiste (dinheiro -> Decimal128).
        const storageDoc = movementToStorage(doc)
        const insertRes = await movements.insertOne(storageDoc as any, { session })

        // 8. Ajusta o saldo da conta na mesma transação ($inc Decimal128,
        //    escopado por restaurantId — via helper compartilhado).
        const impact = balanceImpact({
          direction: input.direction,
          status: status as any,
          grossValue: input.grossValue,
          netValue: snapshot.netValue,
        })
        await applyBalanceImpact(accounts, account._id, ctx.restaurantId, impact, 1, session, now)

        created = movementFromStorage({ ...(storageDoc as any), _id: insertRes.insertedId })
      })

      return created
    } finally {
      await session.endSession()
    }
  }
}
