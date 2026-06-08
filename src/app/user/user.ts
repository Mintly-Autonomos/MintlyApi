export type UserStatus = 'active' | 'inactive' | 'blocked'
export type UserRole = 'admin' | 'member'

export interface User {
  _id?: string
  name: string
  email: string
  cpf?: string
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
