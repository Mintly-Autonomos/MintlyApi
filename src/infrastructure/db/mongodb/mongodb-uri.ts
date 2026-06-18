/**
 * Monta a connection string do MongoDB.
 *
 * Preferimos a forma "standard" (não-SRV) montada a partir de campos separados:
 * o SRV (`mongodb+srv://`) depende de resolução de registros DNS SRV/TXT, que
 * algumas redes/ISPs bloqueiam — causando falha de conexão em parte do time.
 *
 * `MONGODB_URI` tem precedência quando definida (usada por testes com
 * mongodb-memory-server e como escape hatch). Sem ela, a URI é montada a partir
 * de: MONGODB_HOSTS, MONGODB_USER, MONGODB_PASSWORD, MONGODB_REPLICA_SET,
 * MONGODB_AUTH_SOURCE e MONGODB_TLS.
 */
type MongoEnv = Record<string, string | undefined>

export function buildMongoUri (env: MongoEnv = process.env): string {
  if (env.MONGODB_URI) {
    return env.MONGODB_URI
  }

  const hosts = env.MONGODB_HOSTS
  if (!hosts) {
    throw new Error('Configure MONGODB_URI ou MONGODB_HOSTS para conectar ao MongoDB')
  }

  const user = env.MONGODB_USER
  const credentials = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(env.MONGODB_PASSWORD ?? '')}@`
    : ''

  const params = new URLSearchParams()
  if (env.MONGODB_TLS !== 'false') {
    params.set('ssl', 'true')
  }
  if (env.MONGODB_REPLICA_SET) {
    params.set('replicaSet', env.MONGODB_REPLICA_SET)
  }
  params.set('authSource', env.MONGODB_AUTH_SOURCE ?? 'admin')
  params.set('retryWrites', 'true')
  params.set('w', 'majority')

  return `mongodb://${credentials}${hosts}/?${params.toString()}`
}
