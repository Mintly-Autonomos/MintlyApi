import { describe, it, expect } from 'vitest'
import { getRequestUser } from './request-user'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

describe('getRequestUser', () => {
  it('extrai e tipa os claims do jwt anexado pelo verify-jwt', () => {
    const request: any = {
      jwtClaims: {
        subject: 'u1',
        claims: { name: 'João', email: 'joao@x.com', restaurantId: 'r1', role: 'owner', status: 'active', cpf: '123' },
      },
    }
    expect(getRequestUser(request)).toEqual({
      userId: 'u1', name: 'João', email: 'joao@x.com', cpf: '123', restaurantId: 'r1', role: 'owner', status: 'active',
    })
  })

  it('lança UnauthorizedError quando o hook não anexou os claims', () => {
    expect(() => getRequestUser({} as any)).toThrow(UnauthorizedError)
  })
})
