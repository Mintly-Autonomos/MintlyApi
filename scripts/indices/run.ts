import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { ensureAllIndexes } from '../../src/infrastructure/db/indices'

/**
 * Garante os índices de todas as collections no banco do ambiente.
 *
 * Uso: `npm run db:indices` (lê `MONGODB_URI` e `MONGO_ENV`).
 * O nome do banco é o `env` — `getDatabase(env)` resolve para `client.db(env)`.
 * Rodado pelo job do pipeline antes do deploy; idempotente, pode repetir.
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV ?? process.env.APP_ENV ?? 'default'
  const connection = MongoDBConnection.getInstance()

  await connection.connect()
  try {
    console.log(`Garantindo índices no banco "${env}"...`)
    await ensureAllIndexes(env)
    console.log('Índices garantidos com sucesso.')
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha ao garantir índices:', error)
  process.exit(1)
})
