export type OrganizationRole = 'administrador' | 'membro'

export interface OrganizationMember {
  _id?: string
  organizationId: string
  userId: string
  papel: OrganizationRole
  createdAt: string
}
