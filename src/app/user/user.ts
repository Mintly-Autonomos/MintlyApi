export interface User {
  _id?: string
  nome: string
  email: string
  cpf?: string
  passwordHash: string
  termosAceitos: boolean
  aceitouTermosEm?: string
  ultimoAcesso?: string
  createdAt: string
  updatedAt: string
}
