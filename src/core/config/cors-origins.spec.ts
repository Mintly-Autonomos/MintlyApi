import { describe, it, expect } from 'vitest'
import { buildCorsOriginChecker } from './cors-origins'

describe('buildCorsOriginChecker (P4)', () => {
  it('aceita origem da allowlist', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: 'https://app.mintly.com.br', NODE_ENV: 'production' } as any)
    expect(allowed('https://app.mintly.com.br')).toBe(true)
  })

  it('recusa origem fora da allowlist', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: 'https://app.mintly.com.br', NODE_ENV: 'production' } as any)
    expect(allowed('https://site-malicioso.com')).toBe(false)
  })

  it('aceita requisição SEM Origin (curl, cron, testes com inject)', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: '', NODE_ENV: 'production' } as any)
    expect(allowed(undefined)).toBe(true)
  })

  it('aceita localhost fora de produção (dev contra staging)', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: '', NODE_ENV: 'development' } as any)
    expect(allowed('http://localhost:4200')).toBe(true)
    expect(allowed('http://127.0.0.1:3000')).toBe(true)
  })

  it('recusa localhost EM produção', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: 'https://app.mintly.com.br', NODE_ENV: 'production' } as any)
    expect(allowed('http://localhost:4200')).toBe(false)
  })

  it('aceita múltiplas origens no CSV, ignorando espaços', () => {
    const allowed = buildCorsOriginChecker({
      CORS_ORIGINS: 'https://a.com, https://b.com',
      NODE_ENV: 'production',
    } as any)
    expect(allowed('https://a.com')).toBe(true)
    expect(allowed('https://b.com')).toBe(true)
    expect(allowed('https://c.com')).toBe(false)
  })
})
