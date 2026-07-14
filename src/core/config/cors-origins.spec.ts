import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('allowlist vazia em produção nega TODA origem (por que CORS_ORIGINS é obrigatória no deploy)', () => {
    const allowed = buildCorsOriginChecker({ CORS_ORIGINS: undefined, NODE_ENV: 'production' } as any)
    expect(allowed('https://mintly.vercel.app')).toBe(false)
    expect(allowed('http://localhost:4200')).toBe(false)
  })
})

/**
 * Contrato de deploy: a allowlist do CORS só existe no runtime se a var chegar
 * ao ambiente. Sem `CORS_ORIGINS` no `env:` dos jobs E na lista `REQUIRED` do
 * sync p/ a Vercel, o servidor sobe com allowlist vazia + NODE_ENV=production
 * (a Vercel força) e nega toda origem — o MintlyWeb perde a API. Este teste
 * trava essa regressão silenciosa.
 */
describe('deploy.yml propaga CORS_ORIGINS ao runtime', () => {
  const deploy = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')

  it('declara CORS_ORIGINS no env: dos dois jobs (Vercel e EC2)', () => {
    const declarations = deploy.match(/^\s*CORS_ORIGINS: \$\{\{ secrets\.CORS_ORIGINS \}\}$/gm) ?? []
    expect(declarations).toHaveLength(2)
  })

  it('inclui CORS_ORIGINS na lista REQUIRED do sync de env vars da Vercel', () => {
    const required = (deploy.match(/^\s*REQUIRED="[^"]*"$/gm) ?? []).join(' ')
    expect(required).toContain('CORS_ORIGINS')
  })
})
