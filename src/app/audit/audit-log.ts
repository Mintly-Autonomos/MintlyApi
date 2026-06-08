export type AuditEvent =
  | 'account_created'
  | 'restaurant_created'
  | 'terms_accepted'
  | 'onboarding_completed'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'account_temporarily_blocked'
  | 'password_recovery_requested'
  | 'password_reset'

export interface AuditLog {
  _id?: string
  event: AuditEvent
  userId: string
  restaurantId?: string
  data: Record<string, unknown>
  createdAt: string
}
