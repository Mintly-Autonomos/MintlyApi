import { ClientSession, ObjectId } from 'mongodb'
import { financialMovementSchema, MovementDirection, MovementOrigin, MovementStatusSource } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { Resource } from '../../../core/types/resource'
import { FinancialMovementRepository, movementToStorage, movementFromStorage, duplicateKey } from '../financial-movement-repository'
import { computeSnapshot, defaultStatus, balanceImpact, resolveDueDate, resolveSettledAt, resolveMovementSubcategory, BalanceImpact } from '../movement-rules'
import { applyBalanceImpact, applyBalanceImpacts } from '../movement-balance'
import { MovementItemRequest, StoredMovementItem, resolveMovementItems, resolveMovementItemsFrom } from '../movement-items'

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
  /** Pratos vendidos: o servidor copia nome e preço do cardápio. */
  items?: MovementItemRequest[]
  origin?: string
  confirmDuplicate?: boolean
  /** Fatia 5: subcategoria da categoria escolhida (tem que estar ativa). */
  subcategoryId?: string
  /** Fatia 5: canal informado; ausente, os relatórios usam o canal efetivo. */
  channel?: string
}

const DUPLICATE_MESSAGE = 'Possível movimentação duplicada nos últimos 2 minutos. Reenvie com confirmDuplicate=true para confirmar.'

/** Conta viva (tenant-scoped) — precisa existir e estar ativa. */
function ensureAccount (account: any, accountId: string): void {
  if (!account) throw new NotFoundError(Resource.FinancialAccount, accountId)
  if (account.status !== 'active') {
    throw new ConflictError('Conta inativa não pode receber lançamentos financeiros.')
  }
}

/** Categoria viva (tenant-scoped). */
function ensureCategory (category: any, categoryId: string): void {
  if (!category) throw new NotFoundError(Resource.FinancialCategory, categoryId)
}

/** A movimentação pronta para gravar, antes de tocar no banco. */
interface MovementDraft {
  doc: Record<string, any>
  date: Date
  impact: BalanceImpact
  now: Date
}

/**
 * Tudo o que a movimentação decide SEM banco, dadas a conta e a categoria já carregadas e conferidas:
 * taxa e líquido, vencimento, status, documento (com cópia de conta/categoria/pratos) e validação do
 * schema. É o mesmo cálculo para o registro avulso e para a importação em lote.
 */
async function draftMovement (
  input: RegisterMovementInput,
  ctx: RequestContext,
  account: any,
  category: any,
  resolveItems: (items: MovementItemRequest[]) => Promise<StoredMovementItem[]> | StoredMovementItem[],
): Promise<MovementDraft> {
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
  if (snapshot.settlementRuleApplied != null) doc.settlementRuleApplied = snapshot.settlementRuleApplied
  if (dueDate != null) doc.dueDate = dueDate
  // À vista: o dinheiro mexeu na data do lançamento, não na hora do cadastro.
  const settledAt = resolveSettledAt({ newStatus: status, fallback: date })
  if (settledAt != null) doc.settledAt = settledAt
  if (input.counterparty) doc.counterparty = input.counterparty
  if (input.fiscalNote) doc.fiscalNote = input.fiscalNote
  if (input.description) doc.description = input.description
  // Pratos da venda: nome e preço vêm do cardápio vivo (cópia no dia da venda).
  if (input.items?.length) doc.items = await resolveItems(input.items)
  // Fatia 5: subcategoria (opcional, da categoria e ativa) e canal.
  const subcategory = resolveMovementSubcategory({ category: category as any, categoryChanged: true, requested: input.subcategoryId })
  if (subcategory) doc.subcategory = subcategory
  if (input.channel != null) doc.channel = input.channel

  // 5. Validação Sapphire (categoria×direção, limites, grossValue>0...) -> 400.
  financialMovementSchema.parse(doc)

  const impact = balanceImpact({
    direction: input.direction,
    status: status as any,
    grossValue: input.grossValue,
    netValue: snapshot.netValue,
  })
  return { doc, date, impact, now }
}

/**
 * Resultado do registro em lote: tudo gravado (as movimentações, na ordem das linhas) ou NADA gravado,
 * com o erro de cada linha que barrou o lote (índice da linha → erro).
 */
export type BatchRegisterResult =
  | { written: true; movements: any[] }
  | { written: false; errors: Map<number, unknown> }

/**
 * Registra uma movimentação (entrada ou saída) e ajusta o saldo da conta na
 * MESMA transação (MIN-49/50). Busca conta (ativa) + categoria vivas para o
 * snapshot (Extended Reference); calcula fee/net/vencimento; status default pela
 * presença do vencimento; bloqueia duplicidade (<2min) salvo `confirmDuplicate`.
 *
 * Com `outerSession` (importação em lote) NÃO abre transação própria: grava dentro da transação
 * de quem chamou, que decide commitar ou desfazer tudo.
 */
export class RegisterMovementUseCase {
  constructor (private readonly movementRepo: FinancialMovementRepository = new FinancialMovementRepository()) {}

  async execute (input: RegisterMovementInput, ctx: RequestContext, outerSession?: ClientSession): Promise<any> {
    const connection = MongoDBConnection.getInstance()
    const session = outerSession ?? connection.getClient().startSession()
    const db = connection.getDatabase(ctx.env)

    try {
      let created: any
      const run = async (): Promise<void> => {
        const accounts = db.collection('financial_accounts')
        const categories = db.collection('financial_categories')
        const movements = db.collection('financial_movements')

        // 1. Conta viva (tenant-scoped) — precisa estar ativa.
        const account = ObjectId.isValid(input.accountId)
          ? await accounts.findOne({ _id: new ObjectId(input.accountId), restaurantId: ctx.restaurantId }, { session })
          : null
        ensureAccount(account, input.accountId)

        // 2. Categoria viva (tenant-scoped).
        const category = ObjectId.isValid(input.categoryId)
          ? await categories.findOne({ _id: new ObjectId(input.categoryId), restaurantId: ctx.restaurantId }, { session })
          : null
        ensureCategory(category, input.categoryId)

        // 3-5. Cálculo, documento e validação (sem banco), exceto o cardápio dos pratos.
        const { doc, date, impact, now } = await draftMovement(
          input, ctx, account, category,
          (items) => resolveMovementItems({ db, restaurantId: ctx.restaurantId ?? '', items, session }),
        )

        // 6. Duplicidade (<2min) — bloqueia salvo confirmação explícita.
        if (!input.confirmDuplicate) {
          const dup = await this.movementRepo.findDuplicate(
            { accountId: doc.account._id, title: input.title, grossValue: input.grossValue, date },
            ctx,
            session,
          )
          if (dup) throw new ConflictError(DUPLICATE_MESSAGE)
        }

        // 7. Persiste (dinheiro -> Decimal128).
        const storageDoc = movementToStorage(doc)
        const insertRes = await movements.insertOne(storageDoc as any, { session })

        // 8. Ajusta o saldo da conta na mesma transação ($inc Decimal128,
        //    escopado por restaurantId — via helper compartilhado).
        await applyBalanceImpact(accounts, account!._id, ctx.restaurantId, impact, 1, session, now)

        created = movementFromStorage({ ...(storageDoc as any), _id: insertRes.insertedId })
      }
      if (outerSession) await run()
      else await session.withTransaction(run)

      return created
    } finally {
      if (!outerSession) await session.endSession()
    }
  }

  /**
   * Registra várias movimentações de uma vez (importação), na transação de quem chama, com o MESMO
   * cálculo e as MESMAS regras de `execute` — mas sem consultar o banco a cada linha: conta, categoria
   * e pratos são lidos uma vez só, a duplicidade é conferida numa consulta só, as movimentações entram
   * num `insertMany` e o saldo de cada conta recebe um único `$inc` com a soma. O custo no banco passa
   * a ser de umas poucas operações, não de umas cinco por linha.
   *
   * É tudo ou nada: se qualquer linha tiver problema (conta inexistente, duplicata, schema...), nada é
   * gravado e o resultado traz o erro de cada linha com problema, todos de uma vez.
   */
  async executeBatch (inputs: RegisterMovementInput[], ctx: RequestContext, session: ClientSession): Promise<BatchRegisterResult> {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    const accounts = db.collection('financial_accounts')
    const categories = db.collection('financial_categories')
    const movements = db.collection('financial_movements')

    // Operações em sequência: uma sessão em transação não aceita comandos simultâneos.
    const loadById = async (collection: typeof accounts, ids: string[]): Promise<Map<string, any>> => {
      const objectIds = [...new Set(ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id).toHexString()))]
        .map((hex) => new ObjectId(hex))
      if (objectIds.length === 0) return new Map()
      const docs = await collection.find({ _id: { $in: objectIds }, restaurantId: ctx.restaurantId }, { session }).toArray()
      return new Map(docs.map((d) => [String(d._id), d]))
    }
    const accountsById = await loadById(accounts, inputs.map((i) => i.accountId))
    const categoriesById = await loadById(categories, inputs.map((i) => i.categoryId))
    const dishesById = await loadById(
      db.collection('menu_items'),
      inputs.flatMap((i) => (i.items ?? []).map((item) => item.menuItemId)),
    )
    const lookup = (map: Map<string, any>, id: string): any =>
      ObjectId.isValid(id) ? map.get(new ObjectId(id).toHexString()) ?? null : null

    const errors = new Map<number, unknown>()
    const drafts: { index: number; account: any; draft: MovementDraft }[] = []
    const duplicateChecks: { index: number; key: string; criteria: { accountId: string; title: string; grossValue: number; date: Date } }[] = []
    // Linhas que chegam a ser gravadas: uma repetida no lote (sem confirmDuplicate) é duplicata da anterior.
    const seen = new Set<string>()

    for (const [index, input] of inputs.entries()) {
      try {
        const account = lookup(accountsById, input.accountId)
        ensureAccount(account, input.accountId)
        const category = lookup(categoriesById, input.categoryId)
        ensureCategory(category, input.categoryId)

        const draft = await draftMovement(input, ctx, account, category, (items) => resolveMovementItemsFrom(items, dishesById))

        const criteria = { accountId: draft.doc.account._id as string, title: input.title, grossValue: input.grossValue, date: draft.date }
        const key = duplicateKey(criteria)
        if (!input.confirmDuplicate) {
          if (seen.has(key)) throw new ConflictError(DUPLICATE_MESSAGE)
          duplicateChecks.push({ index, key, criteria })
        }
        seen.add(key)
        drafts.push({ index, account, draft })
      } catch (error) {
        errors.set(index, error)
      }
    }

    // Duplicidade contra o que já está no banco (<2min): uma consulta para o lote inteiro.
    const alreadyThere = await this.movementRepo.findDuplicateKeys(duplicateChecks.map((c) => c.criteria), ctx, session)
    for (const check of duplicateChecks) {
      if (alreadyThere.has(check.key) && !errors.has(check.index)) {
        errors.set(check.index, new ConflictError(DUPLICATE_MESSAGE))
      }
    }

    if (errors.size > 0) return { written: false, errors }
    if (drafts.length === 0) return { written: true, movements: [] }

    const storageDocs = drafts.map(({ draft }) => movementToStorage(draft.doc))
    const insertRes = await movements.insertMany(storageDocs as any[], { session })
    await applyBalanceImpacts(
      accounts,
      drafts.map(({ account, draft }) => ({ accountId: account._id as ObjectId, impact: draft.impact })),
      ctx.restaurantId,
      session,
      new Date(),
    )

    return {
      written: true,
      movements: storageDocs.map((doc, i) => movementFromStorage({ ...(doc as any), _id: insertRes.insertedIds[i] })),
    }
  }
}
