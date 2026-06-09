export type AuditEvent =
  | 'account_created'
  | 'restaurant_created'
  | 'terms_accepted'
  | 'onboarding_completed'

export interface AuditLog {
  _id?: string
  event: AuditEvent
  userId: string
  restaurantId?: string
  data: Record<string, unknown>
  createdAt: string
}
