import { ClientSession, Db } from 'mongodb'
import { CategoryBehavior, CategoryType, DreGroup, OperationalNature, SystemCategoryKey, RecordStatus } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'

/**
 * Categorias do sistema para transferência entre contas e saldo inicial (relatório Sweetie Bel, S3.2).
 * Criadas na primeira vez que o restaurante precisa delas (uma por `systemKey`). Natureza "Não
 * operacional": ficam fora do lucro, dos custos, das receitas e do imposto pelo filtro que já existe;
 * e os relatórios ainda as tiram das linhas de não operacional e do Fluxo de caixa (`systemCategoryIds`).
 */
const DEFINITIONS: Record<SystemCategoryKey, { name: string; type: CategoryType; dreGroup?: DreGroup }> = {
  [SystemCategoryKey.TransferOut]: { name: 'Transferência entre contas (saída)', type: CategoryType.Expense, dreGroup: DreGroup.Opex },
  [SystemCategoryKey.TransferIn]: { name: 'Transferência entre contas (entrada)', type: CategoryType.Revenue },
  [SystemCategoryKey.OpeningBalance]: { name: 'Saldo inicial', type: CategoryType.Revenue },
}

/** A categoria do sistema do restaurante (cria se ainda não existe). Idempotente. */
export async function ensureSystemCategory (
  db: Db,
  restaurantId: string | undefined,
  key: SystemCategoryKey,
  session: ClientSession,
  actor: string,
): Promise<any> {
  const categories = db.collection('financial_categories')
  const def = DEFINITIONS[key]
  const now = new Date()
  const insert: Record<string, unknown> = {
    restaurantId,
    name: def.name,
    type: def.type,
    behavior: CategoryBehavior.Fixed,
    operationalNature: OperationalNature.NonOperational,
    status: RecordStatus.Active,
    isSystem: true,
    systemKey: key,
    usage: 0,
    history: [{ at: now, by: actor, action: 'system:create' }],
    subcategories: [],
    audit: { createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor },
  }
  if (def.dreGroup) insert.dreGroup = def.dreGroup
  return categories.findOneAndUpdate(
    { restaurantId, systemKey: key },
    { $setOnInsert: insert },
    { upsert: true, returnDocument: 'after', session },
  )
}

/** Ids (texto) das categorias do sistema do restaurante: os relatórios as deixam de fora. */
export async function systemCategoryIds (db: Db, restaurantId: string | undefined): Promise<string[]> {
  const docs = await db.collection('financial_categories')
    .find({ restaurantId, systemKey: { $exists: true } }, { projection: { _id: 1 } })
    .toArray()
  return docs.map((d) => String(d._id))
}

/**
 * Lançamento avulso (registro, importação, edição) não pode usar categoria do sistema: a transferência
 * tem os dois lados e o saldo inicial é um por conta.
 */
export function assertNotSystemCategory (category: any): void {
  if (category?.systemKey) {
    throw new ValidationError('Esta categoria é do sistema: use "Transferir entre contas" ou o saldo inicial da conta.')
  }
}
