import { describe, it, expect } from 'vitest'
import { buildRequestContext } from './build-request-context'

describe('buildRequestContext', () => {
  it('extrai env do header "env"', () => {
    const ctx = buildRequestContext({ env: 'staging' })
    expect(ctx.env).toBe('staging')
  })

  it('default para "default" quando o header está ausente', () => {
    const ctx = buildRequestContext(undefined)
    expect(ctx.env).toBe('default')
  })

  it('default para "default" quando o header existe mas não tem env', () => {
    const ctx = buildRequestContext({ 'content-type': 'application/json' })
    expect(ctx.env).toBe('default')
  })

  it('coage env não-string pra string', () => {
    const ctx = buildRequestContext({ env: ['production'] as any })
    expect(ctx.env).toBe('production')
  })

  it('popula userId e restaurantId a partir do jwtClaims anexado pelo verify-jwt', () => {
    const request: any = {
      headers: { env: 'staging' },
      jwtClaims: { subject: 'user-1', claims: { restaurantId: 'rest-1' } },
    }
    const ctx = buildRequestContext(request)
    expect(ctx.env).toBe('staging')
    expect(ctx.userId).toBe('user-1')
    expect(ctx.restaurantId).toBe('rest-1')
  })

  it('request sem jwtClaims (rota pública) gera contexto sem identidade', () => {
    const ctx = buildRequestContext({ headers: { env: 'e2e' } } as any)
    expect(ctx.env).toBe('e2e')
    expect(ctx.userId).toBeUndefined()
    expect(ctx.restaurantId).toBeUndefined()
  })
})
