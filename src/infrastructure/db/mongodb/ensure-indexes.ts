import MongoDBConnection from './mongodb-connection'
import { authDbName } from '../../../app/auth/auth-db'

/** B4: garante índices críticos na startup. Idempotente — safe para rodar múltiplas vezes. */
export async function ensureIndexes (): Promise<void> {
  const db = MongoDBConnection.getInstance().getDatabase(authDbName())
  await db.collection('users').createIndex({ email: 1 }, { unique: true })
}
