export interface PasswordResetToken {
  _id?: string
  /** sha256 do token enviado por e-mail — o token em claro nunca é persistido. */
  token: string
  userId: string
  /** Date (não string ISO): o índice TTL do Mongo só funciona com BSON Date. */
  expiresAt: Date
  usedAt?: string | null
  createdAt: string
}
