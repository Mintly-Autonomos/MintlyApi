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
  | 'avatar_updated'
  | 'avatar_removed'
  | 'account_updated'
  | 'email_changed'
  | 'password_changed'
  | 'password_confirmation_failed'
  | 'member_created'
  | 'member_updated'
  | 'members_deactivated_by_plan'
  | 'menu_item_deleted'
  | 'deletion_requested'
  | 'deletion_cancelled'

export interface AuditLog {
  _id?: string
  event: AuditEvent
  userId: string
  restaurantId?: string
  data: Record<string, unknown>
  createdAt: Date
}
