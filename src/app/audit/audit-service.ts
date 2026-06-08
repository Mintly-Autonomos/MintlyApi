import { Collection } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { AuditEvent, AuditLog } from './audit-log'

function getCollection (): Collection<AuditLog> {
  const db = MongoDBConnection.getInstance().getDatabase(
    process.env.MONGODB_AUTH_DB ?? process.env.MONGODB_DB ?? 'mintly',
  )
  return db.collection<AuditLog>('audit_logs')
}

export async function logAudit (
  evento: AuditEvent,
  userId: string,
  dados: Record<string, unknown> = {},
  organizationId?: string,
): Promise<void> {
  const entry: AuditLog = {
    evento,
    userId,
    organizationId,
    dados,
    criadoEm: new Date().toISOString(),
  }
  await getCollection().insertOne(entry).catch(() => null)
}
