export type UserStatus = 'ativo' | 'inativo' | 'bloqueado'

export interface User {
  _id?: string
  nome: string
  email: string
  cpf?: string
  passwordHash: string
  status: UserStatus
  termosAceitos: boolean
  aceitouTermosEm?: string
  ultimoAcesso?: string
  loginAttempts: number
  bloqueadoAte?: string | null
  createdAt: string
  updatedAt: string
}
