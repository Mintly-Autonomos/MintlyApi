import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'

/**
 * Migração do vencimento (M1): `predictedReceiptDate` → `dueDate`.
 *
 * Sem ela, o backlog de pendentes fica invisível para a liquidação automática —
 * o filtro do settler procura `dueDate`, e campo ausente nunca casa um filtro de
 * data. Os movimentos gravados antes desta fatia ficariam "a receber" para
 * sempre, que é exatamente o problema que o P1 resolveu.
 *
 * Idempotente: pode rodar quantas vezes quiser; a segunda execução reporta zero.
 * Cross-tenant de propósito, como o settler — o tenant é campo do documento, não
 * banco. Lê `MONGO_ENV`, igual ao `db:indices`.
 *
 * Uso: `MONGO_ENV=staging npm run db:backfill-due-date`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  if (!env) {
    throw new Error('MONGO_ENV é obrigatório (ex.: MONGO_ENV=staging npm run db:backfill-due-date).')
  }

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const movements = connection.getDatabase(env).collection('financial_movements')

    // 1. Renomeia onde ainda não existe `dueDate`. `$rename` preserva o valor e
    //    remove o campo antigo numa operação só.
    const renamed = await movements.updateMany(
      { predictedReceiptDate: { $exists: true }, dueDate: { $exists: false } },
      { $rename: { predictedReceiptDate: 'dueDate' } },
    )

    // 2. Sobra: documento que já tem `dueDate` (gravado pela API nova) e ainda
    //    carrega o campo velho. O `dueDate` é a verdade; o resto é lixo.
    const cleaned = await movements.updateMany(
      { predictedReceiptDate: { $exists: true } },
      { $unset: { predictedReceiptDate: '' } },
    )

    // 3. O índice do settler antigo não serve a nenhuma query viva.
    const indexes = await movements.indexes()
    const staleIndex = indexes.find((index) => index.name === 'status_1_predictedReceiptDate_1')
    if (staleIndex?.name != null) await movements.dropIndex(staleIndex.name)

    console.log(
      `[${env}] renomeados: ${renamed.modifiedCount} | ` +
      `limpos: ${cleaned.modifiedCount} | ` +
      `indice antigo: ${staleIndex != null ? 'removido' : 'ausente'}`,
    )
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha na migração do vencimento:', error)
  process.exit(1)
})
