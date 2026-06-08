export type AuditEvent =
  | 'conta_criada'
  | 'organizacao_criada'
  | 'termos_aceitos'
  | 'onboarding_concluido'
  | 'login'
  | 'login_falhou'
  | 'logout'
  | 'conta_bloqueada_temporariamente'
  | 'senha_recuperacao_solicitada'
  | 'senha_redefinida'

export interface AuditLog {
  _id?: string
  evento: AuditEvent
  userId: string
  organizationId?: string
  dados: Record<string, unknown>
  criadoEm: string
}
