import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../../src/app/environment/env-allowlist'

/**
 * Semeia a allowlist de ambientes válidos em `app.valid_environments` (C2).
 * Enquanto a collection estiver vazia, a validação de env é permissiva; rodar
 * este script ATIVA a proteção (só os envs abaixo passam a ser aceitos).
 *
 * Uso: `npm run db:seed-envs` (lê MONGODB_URI). Idempotente — pode repetir.
 * Ajuste a lista via APP_VALID_ENVS (CSV) se precisar de outros ambientes.
 */
const ENVS = (process.env.APP_VALID_ENVS ?? 'staging,production')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

async function main (): Promise<void> {
  const connection = MongoDBConnection.getInstance()
  await connection.connect()
  try {
    const col = connection.getDatabase(APP_DB).collection('valid_environments')
    await col.createIndex({ name: 1 }, { unique: true })
    for (const name of ENVS) {
      await col.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true })
    }
    console.log(`Envs válidos garantidos em ${APP_DB}.valid_environments: ${ENVS.join(', ')}`)
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha ao semear os envs válidos:', error)
  process.exit(1)
})
