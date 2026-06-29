import MongoDBConnection from '../mongodb/mongodb-connection'
import * as financialAccounts from './financial-accounts'
import * as financialMovements from './financial-movements'

/**
 * Registro de módulos de índice — um por collection.
 * Ao criar um módulo novo em `./<collection>.ts`, basta adicioná-lo aqui.
 *
 * Cada módulo expõe `collection` (nome) e `ensure(col)` (cria os índices,
 * idempotente). Não há tracking de "já rodou": como `createIndex` é no-op
 * quando o índice já existe, o runner roda tudo a cada deploy com segurança,
 * por ambiente (o env define o banco em `getDatabase(env)`).
 */
const modules = [financialAccounts, financialMovements]

/**
 * Garante (idempotente) todos os índices registrados no banco do `env`.
 * Pressupõe conexão já aberta (`MongoDBConnection.connect()`).
 */
export async function ensureAllIndexes (env: string): Promise<void> {
  const db = MongoDBConnection.getInstance().getDatabase(env)

  for (const mod of modules) {
    await mod.ensure(db.collection(mod.collection))
  }
}
