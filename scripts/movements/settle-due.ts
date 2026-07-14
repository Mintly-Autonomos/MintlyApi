import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../../src/app/environment/env-allowlist'
import { SettleDueMovementsUseCase } from '../../src/app/financial-movement/use-cases/settle-due-movements.use-case'

/**
 * Liquidação automática por data (P1): roda o settler para TODOS os ambientes
 * listados em `app.valid_environments`.
 *
 * Uso: `npm run db:settle` (lê as vars de conexão do Mongo). Idempotente — pode
 * repetir sem duplicar saldo. Agendado 1x/dia pelo workflow `settle.yml`.
 *
 * Por que um script direto no banco, e não uma rota HTTP: um settler exposto por
 * HTTP exigiria um segundo mecanismo de auth (segredo) ou um usuário de sistema —
 * e este obrigaria a afrouxar a invariante "todo token tem dono" para atender um
 * robô. O `db:indices` já roda assim no deploy; este segue o mesmo caminho.
 */
async function main (): Promise<void> {
  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const envs = await connection
      .getDatabase(APP_DB)
      .collection<{ name: string }>('valid_environments')
      .find({}, { projection: { name: 1 } })
      .toArray()

    if (envs.length === 0) {
      console.warn(`Nenhum ambiente em ${APP_DB}.valid_environments — nada a liquidar. Rode 'npm run db:seed-envs' primeiro.`)
      return
    }

    const useCase = new SettleDueMovementsUseCase()

    for (const { name } of envs) {
      const result = await useCase.execute({ env: name })
      console.log(`[${name}] liquidados: ${result.settled} | falhas: ${result.failed}`)

      // Falha em liquidar é anomalia (conta apagada, corrida) — o exit code != 0
      // faz o workflow ficar vermelho em vez de sumir num log que ninguém lê.
      if (result.failed > 0) process.exitCode = 1
    }
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha na liquidação automática:', error)
  process.exit(1)
})
