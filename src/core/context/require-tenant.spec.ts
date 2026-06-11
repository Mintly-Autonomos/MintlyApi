import { describe, it, expect } from 'vitest'
import { requireTenant } from './require-tenant'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

describe('requireTenant', () => {
  it('devolve userId e restaurantId quando o contexto tem identidade', () => {
    const tenant = requireTenant({ env: 'default', userId: 'user-1', restaurantId: 'rest-1' })
    expect(tenant).toEqual({ userId: 'user-1', restaurantId: 'rest-1' })
  })

  it('lança UnauthorizedError quando falta userId (rota sem verify-jwt)', () => {
    expect(() => requireTenant({ env: 'default', restaurantId: 'rest-1' })).toThrow(UnauthorizedError)
  })

  it('lança UnauthorizedError quando falta restaurantId', () => {
    expect(() => requireTenant({ env: 'default', userId: 'user-1' })).toThrow(UnauthorizedError)
  })
})
