import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { toLocalDay } from '../../src/app/reports/shared/period'
import {
  SEED_MARKER,
  cashFlowScenarioAccounts,
  cashFlowScenarioExpected,
  cashFlowScenarioMovements,
} from '../../src/app/reports/cash-flow/cash-flow-scenario'

/**
 * Planta o cenário de conferência dos relatórios num restaurante, relativo a
 * hoje (design, Parte 4). Hoje só o Fluxo de Caixa; as próximas fatias
 * acrescentam os seus cenários aqui.
 *
 * Rode num restaurante RECÉM-CRIADO: contas e movimentos que já existirem nele
 * somam nos números e a conferência deixa de bater.
 *
 * Idempotente: apaga o que uma execução anterior plantou (contas "Demo · " e
 * movimentos marcados) antes de plantar de novo.
 *
 * Uso: `MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  const restaurantId = process.env.SEED_RESTAURANT_ID?.trim()
  if (!env || !restaurantId) {
    throw new Error('MONGO_ENV e SEED_RESTAURANT_ID são obrigatórios (ex.: MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo).')
  }
  if (env === 'production') {
    throw new Error('db:seed-demo não roda em produção.')
  }

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const db = connection.getDatabase(env)
    const accountsCol = db.collection('financial_accounts')
    const movementsCol = db.collection('financial_movements')

    await movementsCol.deleteMany({ restaurantId, description: SEED_MARKER })
    await accountsCol.deleteMany({ restaurantId, name: /^Demo · / })

    const accounts = await accountsCol.insertMany(cashFlowScenarioAccounts(restaurantId))
    const today = toLocalDay(new Date())
    const movements = cashFlowScenarioMovements(today, {
      restaurantId,
      account: { _id: String(accounts.insertedIds[0]), name: 'Demo · Caixa', type: 'cash' },
      revenueCategory: { _id: 'seed-demo-revenue', name: 'Vendas (demo)' },
      expenseCategory: { _id: 'seed-demo-expense', name: 'Despesas (demo)' },
    })
    await movementsCol.insertMany(movements)

    console.log(`Plantados: ${accounts.insertedCount} contas, ${movements.length} movimentos (env=${env}, restaurante=${restaurantId}, hoje=${today}).`)
    console.log('Esperado em GET /reports/cash-flow?horizon=30:')
    console.log(JSON.stringify(cashFlowScenarioExpected(today, 30), null, 2))
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
