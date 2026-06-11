import { Collection } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { AuditEvent, AuditLog } from './audit-log'

function getCollection (env = 'default'): Collection<AuditLog> {
  return MongoDBConnection.getInstance()
    .getDatabase(env)
    .collection<AuditLog>('audit_logs')
}

export async function logAudit (
  event: AuditEvent,
  userId: string,
  data: Record<string, unknown> = {},
  restaurantId?: string,
  env = 'default',
): Promise<void> {
  const entry: AuditLog = {
    event,
    userId,
    restaurantId,
    data,
    createdAt: new Date().toISOString(),
  }
  await getCollection(env).insertOne(entry).catch(() => null)
}
