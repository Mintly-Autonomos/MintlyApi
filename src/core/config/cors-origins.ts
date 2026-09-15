const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Allowlist de origens do CORS (P4). Antes disto o servidor usava
 * `cors({ origin: true })`, que REFLETE qualquer `Origin` — ou seja, qualquer site
 * podia chamar a API pelo navegador. Com auth via Bearer o estrago é limitado (o
 * atacante não tem o token da vítima), mas é porta aberta sem motivo.
 *
 * Regras:
 *  - Origem listada em `CORS_ORIGINS` (CSV) → passa.
 *  - **Sem** header `Origin` (curl, o cron, testes com `fastify.inject`) → passa.
 *    CORS é proteção de navegador, não firewall: bloquear aqui não protegeria nada
 *    e quebraria todo cliente não-browser.
 *  - `localhost`/`127.0.0.1` fora de produção → passa (dev local roda com
 *    `NODE_ENV` de desenvolvimento). Em produção, não.
 *
 * ATENÇÃO — o atalho de `localhost` NÃO vale contra a staging: a Vercel força
 * `NODE_ENV=production` mesmo no ambiente de staging, então lá `isProduction` é
 * `true`. Quem quiser desenvolver o front local apontando pra API de staging
 * precisa incluir `http://localhost:4200` na `CORS_ORIGINS` da própria staging
 * (ver `.github/workflows/deploy.yml`).
 *
 * `CORS_ORIGINS` é sincronizada pelo deploy (é `REQUIRED` lá): sem ela a
 * allowlist nasce vazia e, em produção, TODA origem de navegador é negada.
 */
export function buildCorsOriginChecker (
  // `Record` em vez de `NodeJS.ProcessEnv`: o namespace global NodeJS não é
  // reconhecido pelo ESLint (no-undef) e o tipo estrutural aqui basta.
  env: Record<string, string | undefined> = process.env,
): (origin?: string) => boolean {
  const allowlist = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  const isProduction = env.NODE_ENV === 'production'

  return function isOriginAllowed (origin?: string): boolean {
    if (!origin) return true
    if (allowlist.includes(origin)) return true
    if (!isProduction && LOCALHOST.test(origin)) return true
    return false
  }
}
