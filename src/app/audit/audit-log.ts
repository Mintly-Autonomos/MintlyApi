export type AuditEvent =
  | 'conta_criada'
  | 'organizacao_criada'
  | 'termos_aceitos'
  | 'onboarding_concluido'

export interface AuditLog {
  _id?: string
  evento: AuditEvent
  userId: string
  organizationId?: string
  dados: Record<string, unknown>
  criadoEm: string
}
