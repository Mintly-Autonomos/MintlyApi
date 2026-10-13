import { Db, ObjectId } from 'mongodb'
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { addMonths, toLocalDay, toLocalMonth } from '../../src/app/reports/shared/period'
import {
  SEED_MARKER,
  cashFlowScenarioAccounts,
  cashFlowScenarioExpected,
  cashFlowScenarioMovements,
} from '../../src/app/reports/cash-flow/cash-flow-scenario'
import { TAX_SCENARIO_EXPECTED, TAX_SEED_MARKER, taxScenarioMovements } from '../../src/app/tax/tax-scenario'
import { RESULT_SEED_MARKER, resultScenario, resultScenarioExpected } from '../../src/app/reports/result/result-scenario'

/**
 * Planta um cenário de conferência dos relatórios num restaurante, relativo a
 * hoje (design, Parte 4). `SEED_SCENARIO` escolhe qual:
 *  - `cash-flow` (padrão): Fluxo de Caixa (fatia 2);
 *  - `tax`: perfil tributário — 13 meses de receita cruzando da faixa 2 para a
 *    3 no mês corrente, e o restaurante passa a Simples Nacional (fatia 3);
 *  - `result`: DRE do mês ANTERIOR ao corrente (fatia 4) — categorias "Demo · "
 *    classificadas, lançamentos de dois meses e regime Simples (alíquota 6%).
 * Um cenário por restaurante: a receita de um polui o RBT12 do outro.
 *
 * Rode num restaurante RECÉM-CRIADO: contas e movimentos que já existirem nele
 * somam nos números e a conferência deixa de bater.
 *
 * Idempotente: apaga o que uma execução anterior do mesmo cenário plantou
 * antes de plantar de novo.
 *
 * Uso: `[SEED_SCENARIO=tax|result] MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  const restaurantId = process.env.SEED_RESTAURANT_ID?.trim()
  const scenario = (process.env.SEED_SCENARIO ?? 'cash-flow').trim()
  if (!env || !restaurantId) {
    throw new Error('MONGO_ENV e SEED_RESTAURANT_ID são obrigatórios (ex.: MONGO_ENV=default SEED_RESTAURANT_ID=<id> npm run db:seed-demo).')
  }
  if (env === 'production') {
    throw new Error('db:seed-demo não roda em produção.')
  }
  if (scenario !== 'cash-flow' && scenario !== 'tax' && scenario !== 'result') {
    throw new Error(`SEED_SCENARIO inválido: ${scenario} (use cash-flow, tax ou result).`)
  }

  const connection = MongoDBConnection.getInstance()
  await connection.connect()

  try {
    const db = connection.getDatabase(env)
    if (scenario === 'tax') await seedTax(db, env, restaurantId)
    else if (scenario === 'result') await seedResult(db, env, restaurantId)
    else await seedCashFlow(db, env, restaurantId)
  } finally {
    await connection.disconnect()
  }
}

async function seedCashFlow (db: Db, env: string, restaurantId: string): Promise<void> {
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
}

async function seedTax (db: Db, env: string, restaurantId: string): Promise<void> {
  const movementsCol = db.collection('financial_movements')
  await movementsCol.deleteMany({ restaurantId, description: TAX_SEED_MARKER })

  const month = toLocalMonth(new Date())
  const movements = taxScenarioMovements(month, {
    restaurantId,
    account: { _id: 'seed-demo-account', name: 'Demo · Caixa', type: 'cash' },
    revenueCategory: { _id: 'seed-demo-revenue', name: 'Vendas (demo)' },
  })
  await movementsCol.insertMany(movements)
  await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })

  console.log(`Plantados: ${movements.length} movimentos de receita; regime Simples Nacional (env=${env}, restaurante=${restaurantId}, mês=${month}).`)
  console.log('Esperado em GET /restaurants/me:')
  console.log(JSON.stringify(TAX_SCENARIO_EXPECTED, null, 2))
}

async function seedResult (db: Db, env: string, restaurantId: string): Promise<void> {
  const month = addMonths(toLocalMonth(new Date()), -1)
  await db.collection('financial_movements').deleteMany({ restaurantId, description: RESULT_SEED_MARKER })
  await db.collection('financial_categories').deleteMany({ restaurantId, name: /^Demo · / })

  const { categories, movements } = resultScenario(month, restaurantId)
  await db.collection('financial_categories').insertMany(categories)
  await db.collection('financial_movements').insertMany(movements)
  await db.collection('restaurants').updateOne({ _id: new ObjectId(restaurantId) }, { $set: { taxRegime: 'simplesNacionalAnexoI' } })

  console.log(`Plantados: ${categories.length} categorias, ${movements.length} movimentos; regime Simples (env=${env}, restaurante=${restaurantId}).`)
  console.log(`Esperado em GET /reports/result?month=${month}:`)
  console.log(JSON.stringify(resultScenarioExpected(month), null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
