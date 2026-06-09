import type { UserRole, UserStatus } from 'mintly-lib'

/**
 * Claims armazenados no payload criptografado do JWT (AES-256-GCM via valkyrie-jwt).
 * O front recebe o token opaco — estes dados só ficam visíveis após descriptografia na API.
 */
export interface MintlyClaims extends Record<string, unknown> {
  name: string
  email: string
  cpf?: string
  restaurantId: string
  role: UserRole
  status: UserStatus
}
