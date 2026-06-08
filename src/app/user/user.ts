import type { User as PublicUser } from 'mintly-lib'

export type { UserStatus, UserRole } from 'mintly-lib'

/** Documento MongoDB — estende o User público da mintly-lib com internos de autenticação. */
export interface User extends PublicUser {
  passwordHash: string
  loginAttempts: number
  blockedUntil?: string | null
  termsAccepted: boolean
  termsAcceptedAt?: string
}
