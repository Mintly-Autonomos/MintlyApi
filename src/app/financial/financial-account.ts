export type FinancialAccountType = 'Caixa' | 'Conta Bancária' | 'Carteira Digital' | 'Plataforma Financeira'

export interface FinancialAccount {
  _id?: string
  organizationId: string
  nome: string
  tipo: FinancialAccountType
  ativa: boolean
  padrao: boolean
  createdAt: string
  updatedAt: string
}
