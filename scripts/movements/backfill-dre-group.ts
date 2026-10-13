import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { SYSTEM_CATEGORY_DRE_GROUPS } from '../../src/app/financial-category/category-rules'

/**
 * Migração da fatia 3 (M2): dá `dreGroup` às categorias de DESPESA que ainda não
 * têm. As de sistema recebem o grupo pelo nome (o mesmo mapa do onboarding); as
 * demais, `opex` — o dono corrige pelo PATCH. Sem ela, editar uma despesa antiga
 * ainda funciona (a API completa com opex), mas o DRE não sabe classificá-la.
 *
 * Idempotente: a segunda execução reporta 0. Cross-tenant, como o settler.
 * Uso: `MONGO_ENV=staging npm run db:backfill-dre-group`
 */
async function main (): Promise<void> {
  const env = process.env.MONGO_ENV?.trim()
  if (!env) throw new Error('MONGO_ENV é obrigatório (ex.: MONGO_ENV=staging npm run db:backfill-dre-group).')

  const connection = MongoDBConnection.getInstance()
  await connection.connect()
  try {
    const categories = connection.getDatabase(env).collection('financial_categories')
    let bySystem = 0
    for (const [name, dreGroup] of Object.entries(SYSTEM_CATEGORY_DRE_GROUPS)) {
      const res = await categories.updateMany({ type: 'expense', isSystem: true, name, dreGroup: { $exists: false } }, { $set: { dreGroup } })
      bySystem += res.modifiedCount
    }
    const rest = await categories.updateMany({ type: 'expense', dreGroup: { $exists: false } }, { $set: { dreGroup: 'opex' } })
    console.log(`dreGroup (env=${env}): ${bySystem} de sistema | ${rest.modifiedCount} como opex`)
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
