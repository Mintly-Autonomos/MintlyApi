import { Collection } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { AuditEvent, AuditLog } from './audit-log'

function getCollection (env: string): Collection<AuditLog> {
  return MongoDBConnection.getInstance()
    .getDatabase(env)
    .collection<AuditLog>('audit_logs')
}

/**
 * Registra um evento de auditoria no banco do `env` (tenant/ambiente da request).
 * `env` é obrigatório de propósito: sem ele, o default anterior (`'default'`)
 * gravava os logs num banco órfão quando o caller esquecia de passar o ambiente.
 */
export async function logAudit (
  event: AuditEvent,
  userId: string,
  env: string,
  restaurantId: string | undefined,
  data: Record<string, unknown> = {},
): Promise<void> {
  const entry: AuditLog = {
    event,
    userId,
    restaurantId,
    data,
    createdAt: new Date(),
  }
  await getCollection(env).insertOne(entry).catch(() => null)
}
