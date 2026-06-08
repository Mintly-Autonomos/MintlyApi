export interface PasswordResetToken {
  _id?: string
  token: string
  userId: string
  expiresAt: string
  usedAt?: string | null
  createdAt: string
}
