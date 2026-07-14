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
 *  - `localhost`/`127.0.0.1` fora de produção → passa (desenvolver o front contra a
 *    staging não pode exigir mexer em config). Em produção, não.
 */
export function buildCorsOriginChecker (
  env: NodeJS.ProcessEnv = process.env,
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
