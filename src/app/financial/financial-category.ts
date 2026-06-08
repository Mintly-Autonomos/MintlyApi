export type CategoryType = 'income' | 'expense'
export type FinancialBehavior = 'variable' | 'fixed'
export type OperationalNature = 'operational' | 'non_operational'

export interface FinancialCategory {
  _id?: string
  restaurantId: string
  name: string
  type: CategoryType
  behavior: FinancialBehavior
  operationalNature: OperationalNature
  isSystem: boolean
  createdAt: string
  updatedAt: string
}
