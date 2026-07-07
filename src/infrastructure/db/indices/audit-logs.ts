import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `audit_logs` (eventos de segurança: login, bloqueio,
 * recuperação/reset de senha). Sem estes, a collection crescia sem limite e
 * sem suporte de consulta. `createIndex` é idempotente.
 */
export const collection = 'audit_logs'

/**
 * Retenção dos logs de auditoria. TTL evita crescimento ilimitado; 365 dias
 * cobre auditoria de um ano. Ajuste aqui se a política de retenção mudar.
 */
const RETENTION_DAYS = 365

export async function ensure (col: Collection<Document>): Promise<void> {
  // Consulta por tenant + recência (ex.: eventos recentes do restaurante).
  await col.createIndex({ restaurantId: 1, createdAt: -1 })

  // Trilha por usuário/evento (ex.: histórico de logins de um usuário).
  await col.createIndex({ userId: 1, event: 1, createdAt: -1 })

  // TTL: expira automaticamente após a janela de retenção (índice de campo único).
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 })
}
