import { describe, expect, it } from 'vitest'
import { DEPLOY_ENV_KEYS, cleanDeployEnv } from './clean-payment-env'

describe('cleanDeployEnv', () => {
  it('remove as variáveis de pagamento/deploy e não mexe nas demais', () => {
    const env = {
      PAYMENT_PROVIDER: 'mercadopago',
      MP_SANDBOX: 'true',
      MP_ACCESS_TOKEN: 'APP_USR-x',
      MP_WEBHOOK_SECRET: 's',
      ADMIN_API_KEY: 'k',
      API_URL: 'https://api',
      FRONTEND_URL: 'https://app',
      MONGODB_URI: 'mongodb://x',
      NODE_ENV: 'test',
    } as Record<string, string | undefined>

    cleanDeployEnv(env)

    for (const key of DEPLOY_ENV_KEYS) expect(env[key]).toBeUndefined()
    expect(env.MONGODB_URI).toBe('mongodb://x')
    expect(env.NODE_ENV).toBe('test')
  })

  it('o ambiente dos testes já começa sem essas variáveis (mesmo que o runner as tenha)', () => {
    for (const key of DEPLOY_ENV_KEYS) expect(process.env[key]).toBeUndefined()
  })
})
