export type AccountType = 'cash' | 'bank' | 'digital_wallet' | 'financial_platform'

export interface FinancialAccount {
  _id?: string
  restaurantId: string
  name: string
  type: AccountType
  isActive: boolean
  isDefault: boolean
  feePercent?: number
  settlementDays?: number
  createdAt: string
  updatedAt: string
}
