import { AnyBulkWriteOperation, Document } from 'mongodb'
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { toBusinessDate } from '../../src/app/reports/shared/period'

/**
 * Migração das datas de lançamento para o meio-dia em São Paulo.
 *
 * Antes desta correção, `date` e `dueDate` eram gravados à meia-noite UTC (o "AAAA-MM-DD" do formulário e
 * da planilha passado por `new Date`). Os relatórios fecham o mês no horário de São Paulo, então um
 * lançamento do dia 1º (00:00 UTC = 21h do dia anterior) caía no mês anterior. A API nova já grava o
 * meio-dia; este script corrige o que já existe.
 *
 * Só mexe em valores exatamente à meia-noite UTC (o formato antigo). Para `settledAt`, só quando ele era
 * igual à `date` antiga (lançamento à vista, cujo pagamento é o próprio dia): um `settledAt` com hora foi
 * informado pelo dono ou gravado pelo settler e fica como está.
 *
 * Idempotente: a segunda execução reporta zero. Cross-tenant, como o settler. Lê `MONGO_ENV`.
 *
 * Uso: `MONGO_ENV=staging npm run db:normalize-dates` (acrescente `DRY_RUN=1` para só contar)
 */
const BATCH = 500

export function isUtcMidnight (value: unknown): value is Date {
  return value instanceof Date &&
    value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0
}

/** O que muda num documento (vazio = nada a corrigir). Separado para teste. */
export function normalizedDates (doc: { date?: unknown, dueDate?: unknown, settledAt?: unknown }): Record<string, Date> {
  const set: Record<string, Date> = {}
  if (isUtcMidnight(doc.date)) {
    set.date = toBusinessDate(doc.date)
    if (doc.settledAt instanceof Date && doc.settledAt.getTime() === doc.date.getTime()) set.settledAt = set.date
  }
  if (isUtcMidnight(doc.dueDate)) set.dueDate = toBusinessDate(doc.dueDate)
  return set
}

async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  if (!env) {
    throw new Error('MONGO_ENV é obrigatório (ex.: MONGO_ENV=staging npm run db:normalize-dates).')
  }
  const dryRun = process.env.DRY_RUN === '1'

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const movements = connection.getDatabase(env).collection('financial_movements')
    const cursor = movements.find(
      { $or: [{ date: { $type: 'date' } }, { dueDate: { $type: 'date' } }] },
      { projection: { date: 1, dueDate: 1, settledAt: 1 } },
    )

    let read = 0
    let changed = 0
    let ops: AnyBulkWriteOperation<Document>[] = []
    const flush = async (): Promise<void> => {
      if (ops.length > 0 && !dryRun) await movements.bulkWrite(ops, { ordered: false })
      ops = []
    }

    for await (const doc of cursor) {
      read++
      const set = normalizedDates(doc)
      if (Object.keys(set).length === 0) continue
      changed++
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } })
      if (ops.length >= BATCH) await flush()
    }
    await flush()

    console.log(`[${env}] lidos: ${read} | ${dryRun ? 'a corrigir (DRY_RUN)' : 'corrigidos'}: ${changed}`)
  } finally {
    await connection.disconnect()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Falha na migração das datas:', error)
    process.exit(1)
  })
}
