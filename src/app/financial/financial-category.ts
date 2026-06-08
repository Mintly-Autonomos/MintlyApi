export type CategoryType = 'Receita' | 'Despesa'
export type FinancialBehavior = 'Variável' | 'Fixa'
export type OperationalNature = 'Operacional' | 'Não Operacional'

export interface FinancialCategory {
  _id?: string
  organizationId: string
  nome: string
  tipo: CategoryType
  comportamentoFinanceiro: FinancialBehavior
  naturezaOperacional: OperationalNature
  createdAt: string
  updatedAt: string
}
