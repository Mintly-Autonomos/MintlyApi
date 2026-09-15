import { ObjectId } from 'mongodb'
import { financialMovementSchema, MovementStatus, MovementStatusSource } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { computeSnapshot, balanceImpact, defaultStatus, resolveStatusSource } from '../movement-rules'
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

const VALID_STATUS = new Set<string>([MovementStatus.Pending, MovementStatus.Settled, MovementStatus.Cancelled])

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
    if (changes.status != null && !VALID_STATUS.has(changes.status)) {
      throw new ConflictError(`Status inválido: ${changes.status}.`)
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
        const dateChanged = newDate.getTime() !== new Date(mov.date).getTime()

        // P3 — snapshot congelado: a edição reaproveita a taxa/prazo gravados no
        // movimento, para que editar um campo inócuo (ex.: título) não re-precifique
        // o líquido com a taxa ATUAL da conta. EXCEÇÃO: se o usuário TROCOU a conta,
        // não existe snapshot aplicável à conta nova — vale a taxa/prazo vivos dela.
        const accountChanged = changes.accountId != null && changes.accountId !== oldAccountId

        // P1 — trocar de conta RECOMPUTA o status pelas regras da conta NOVA (a
        // mesma `defaultStatus` do registro). Arrastar o status antigo criava um
        // beco sem saída: um `pending` de plataforma movido p/ conta bancária
        // continuava `pending` (dinheiro em "a receber" numa conta que não tem "a
        // receber") e, sem `predictedReceiptDate` — a conta nova não tem prazo —,
        // ficava invisível ao settler PARA SEMPRE.
        const isManual = mov.statusSource === MovementStatusSource.Manual

        // Status explícito no payload só "vence" quando REALMENTE muda o status.
        // Um front que reenvia o formulário inteiro no save manda o status ATUAL
        // junto — isso não pode ser lido como intenção de mexer no status (nem
        // travar o settler, nem neutralizar o recomputo abaixo).
        const statusExplicitlyChanged = changes.status != null && changes.status !== mov.status

        // Recomputo SÓ a partir de `pending`: é o único estado que o bug acima
        // alcança. Recomputar de `cancelled` CRIARIA saldo do nada (a reversão de
        // `cancelled` é no-op e a aplicação de `settled` credita o líquido);
        // recomputar de `settled` (todo movimento liquidado pelo settler é `auto`)
        // devolveria para "a receber" dinheiro que JÁ entrou na conta.
        // `statusSource: 'manual'` (ação humana anterior) é soberano e trava o
        // recálculo.
        const recomputeStatus =
          accountChanged &&
          !isManual &&
          !statusExplicitlyChanged &&
          mov.status === MovementStatus.Pending

        const statusByRules = recomputeStatus
          ? defaultStatus({ direction: direction as any, account: account as any })
          : mov.status
        const newStatus = statusExplicitlyChanged ? changes.status! : statusByRules

        const frozenFee = accountChanged
          ? undefined
          : {
            percent: mov.feePercentApplied != null ? num(mov.feePercentApplied) : undefined,
            settlementDays: mov.settlementDaysApplied != null ? Number(mov.settlementDaysApplied) : undefined,
          }

        const snapshot = computeSnapshot({
          direction: direction as any,
          grossValue: newGross,
          date: newDate,
          account: account as any,
          fee: frozenFee,
        })

        const now = new Date()
        const history = Array.isArray(mov.history) ? [...mov.history] : []
        history.push({ at: now, by: ctx.userId ?? 'system', action: 'update' })

        // Data prevista do documento resultante — decidida ANTES do statusSource,
        // porque a invariante `resolveStatusSource` depende dela.
        let predictedReceiptDate: Date | undefined
        if (snapshot.predictedReceiptDate != null) {
          predictedReceiptDate = snapshot.predictedReceiptDate
        } else if (!accountChanged && !dateChanged && mov.predictedReceiptDate != null) {
          // Blindagem: um doc com `predictedReceiptDate` mas SEM
          // `settlementDaysApplied` (semeado direto no banco, fora da API) não tem
          // como recalcular a data prevista pelo snapshot congelado. Sem isto, o
          // `replaceOne` APAGARIA a data prevista numa edição inócua (até de
          // título) e o movimento sumiria do radar do settler. Só vale enquanto a
          // data prevista continua fazendo sentido: conta e data de origem intactas.
          predictedReceiptDate = new Date(mov.predictedReceiptDate)
        }

        // P1 — statusSource: editar um campo inócuo NÃO tira o movimento do
        // alcance do settler. Só carimba `manual` se ESTA edição mexeu no status
        // (ação humana explícita); caso contrário preserva a origem já gravada
        // (ausente = `auto`, docs anteriores a este campo). Por cima, a invariante
        // de domínio: `pending` sem data prevista é inalcançável pelo settler,
        // logo é `manual`.
        const statusSource = resolveStatusSource({
          status: newStatus,
          predictedReceiptDate,
          statusSource: statusExplicitlyChanged
            ? MovementStatusSource.Manual
            : (mov.statusSource ?? MovementStatusSource.Auto),
        })

        // Documento reconstruído (preserva imutáveis + history + audit.createdAt).
        const newDoc: Record<string, any> = {
          restaurantId: ctx.restaurantId,
          direction,
          title: changes.title ?? mov.title,
          status: newStatus,
          statusSource,
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
        if (predictedReceiptDate != null) newDoc.predictedReceiptDate = predictedReceiptDate
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
        await applyBalanceImpact(accounts, new ObjectId(oldAccountId), ctx.restaurantId, oldImpact, -1, session, now)
        await applyBalanceImpact(accounts, new ObjectId(newAccountId), ctx.restaurantId, newImpact, 1, session, now)

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
