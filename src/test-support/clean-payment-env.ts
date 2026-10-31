/**
 * Isola os testes das variáveis do DEPLOY. O job de deploy roda `npm run test:ci` com o mesmo ambiente
 * que depois vai para a Vercel (PAYMENT_PROVIDER, MP_SANDBOX, MP_ACCESS_TOKEN...): sem isto, criar uma
 * variável no GitHub (ex.: MP_SANDBOX=true) muda o resultado dos testes e trava o deploy.
 * Cada teste que precisa de uma delas a define explicitamente.
 */
export const DEPLOY_ENV_KEYS = [
  'PAYMENT_PROVIDER',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'MP_SANDBOX',
  'ADMIN_API_KEY',
  'API_URL',
  'FRONTEND_URL',
] as const

export function cleanDeployEnv (env: Record<string, string | undefined> = process.env): void {
  for (const key of DEPLOY_ENV_KEYS) delete env[key]
}

cleanDeployEnv()
