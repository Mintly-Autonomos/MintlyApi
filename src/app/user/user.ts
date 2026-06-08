import type { Person } from 'mintly-lib'

export type UserStatus = 'active' | 'inactive' | 'blocked'
export type UserRole = 'admin' | 'member'

/** Documento MongoDB completo — estende os campos públicos de Person da mintly-lib. */
export interface User extends Omit<Person, 'id' | '_id'> {
  _id?: string
  passwordHash: string
  status: UserStatus
  role: UserRole
  restaurantId?: string
  loginAttempts: number
  blockedUntil?: string | null
  termsAccepted: boolean
  termsAcceptedAt?: string
  lastAccessAt?: string
  createdAt: string
  updatedAt: string
}
