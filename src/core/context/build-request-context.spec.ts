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
})
