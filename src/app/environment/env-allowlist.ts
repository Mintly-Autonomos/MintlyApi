import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { InvalidEnvError } from '../../core/errors/core/invalid-env-error'

/**
 * Banco compartilhado (fixo no código): guarda configuração global comum a todos
 * os ambientes — incluindo a allowlist de `env`s válidos. Diferente dos bancos
 * por-tenant (`getDatabase(env)`), staging e production apontam ambos p/ o `app`.
 */
export const APP_DB = 'app'
const COLLECTION = 'valid_environments'
const CACHE_TTL_MS = 60_000

let cache: { envs: Set<string>; loadedAt: number } | null = null

async function loadAllowlist (): Promise<Set<string>> {
  try {
    const docs = await MongoDBConnection.getInstance()
      .getDatabase(APP_DB)
      .collection<{ name: string }>(COLLECTION)
      .find({}, { projection: { name: 1 } })
      .toArray()
    return new Set(docs.map(d => d.name).filter(Boolean))
  } catch {
    // Fail-open: se o `app` DB não é legível, não bloqueia (disponibilidade >
    // este guard, que é de higiene de roteamento, não de autenticação).
    return new Set()
  }
}

/**
 * Valida o `env` contra a allowlist em `app.valid_environments`:
 * - Allowlist COM entradas (prod/staging seedados): o `env` DEVE estar nela,
 *   senão lança `InvalidEnvError` (400).
 * - Allowlist VAZIA/ausente, ou sem conexão com o Mongo (dev/testes, que usam
 *   envs arbitrários e não seedam o `app`): permissivo — não bloqueia nada.
 *
 * Cacheia por `CACHE_TTL_MS` (envs mudam raríssimo; evita ler o `app` DB a cada
 * request). `now` é injetável p/ testar a expiração do cache.
 */
export async function assertValidEnv (env: string, now: number = Date.now()): Promise<void> {
  // Sem conexão não há allowlist a consultar (dev/unit): permissivo.
  if (!MongoDBConnection.getInstance().isConnected()) return

  if (!cache || now - cache.loadedAt > CACHE_TTL_MS) {
    cache = { envs: await loadAllowlist(), loadedAt: now }
  }

  if (cache.envs.size === 0) return // allowlist vazia -> permissivo
  if (!cache.envs.has(env)) {
    throw new InvalidEnvError(env)
  }
}

/** Limpa o cache da allowlist (uso em testes / após seed). */
export function resetEnvAllowlistCache (): void {
  cache = null
}
