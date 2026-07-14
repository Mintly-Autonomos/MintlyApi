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
  // Um ambiente por execução, vindo de SETTLE_ENV — NÃO varre todos os envs da
  // tabela. O código que mexe no dinheiro de produção precisa passar pelo mesmo
  // gate de release (staging → main) que o resto do sistema: varrendo tudo, um
  // commit mergeado na staging moveria saldo real de produção na madrugada
  // seguinte, sem promoção. O workflow amarra ambiente ⇄ branch (settle.yml).
  const env = process.env.SETTLE_ENV?.trim()
  if (!env) {
    throw new Error('SETTLE_ENV é obrigatório (ex.: SETTLE_ENV=staging npm run db:settle).')
  }

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    // Guardrail: só liquida ambiente que existe na allowlist. Sem isso, um typo
    // (`stagign`) criaria/leria um banco vazio e reportaria "0 liquidados" —
    // sucesso silencioso, o pior tipo de falha num job noturno.
    const known = await connection
      .getDatabase(APP_DB)
      .collection<{ name: string }>('valid_environments')
      .findOne({ name: env }, { projection: { name: 1 } })

    if (!known) {
      throw new Error(
        `Ambiente '${env}' não está em ${APP_DB}.valid_environments. ` +
        'Rode \'npm run db:seed-envs\' ou corrija o SETTLE_ENV.',
      )
    }

    const result = await new SettleDueMovementsUseCase().execute({ env })
    console.log(`[${env}] liquidados: ${result.settled} | falhas: ${result.failed}`)

    // Falha em liquidar é anomalia (conta apagada, corrida) — o exit code != 0
    // faz o workflow ficar vermelho em vez de sumir num log que ninguém lê.
    if (result.failed > 0) process.exitCode = 1
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error('Falha na liquidação automática:', error)
  process.exit(1)
})
