import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../../src/app/environment/env-allowlist'
import { TAX_SETTINGS_COLLECTION } from '../../src/app/tax/tax-settings-repository'

/**
 * Grava/atualiza o DAS mensal do MEI vigente a partir de um mês (MIN-23:
 * "configurável sem alterar código"). Vai no banco `app`, do cluster: uma
 * execução vale para staging e produção. Rodar todo ano quando o salário
 * mínimo mudar (comércio: 5% do mínimo de INSS + R$ 1 de ICMS).
 *
 * Uso: `MEI_MONTHLY_DAS=<valor> VALID_FROM=AAAA-MM npm run db:seed-tax-settings`
 */
async function main (): Promise<void> {
  const das = Number(process.env.MEI_MONTHLY_DAS)
  const validFrom = process.env.VALID_FROM?.trim()
  if (!Number.isFinite(das) || das <= 0) throw new Error('MEI_MONTHLY_DAS deve ser um valor positivo (ex.: MEI_MONTHLY_DAS=82.05).')
  if (!validFrom || !/^\d{4}-(0[1-9]|1[0-2])$/.test(validFrom)) throw new Error('VALID_FROM deve ser AAAA-MM (ex.: VALID_FROM=2026-01).')

  const connection = MongoDBConnection.getInstance()
  await connection.connect()
  try {
    const col = connection.getDatabase(APP_DB).collection(TAX_SETTINGS_COLLECTION)
    await col.updateOne({ validFrom }, { $set: { validFrom, meiMonthlyDas: das, updatedAt: new Date() } }, { upsert: true })
    const all = await col.find({}, { projection: { _id: 0, validFrom: 1, meiMonthlyDas: 1 } }).sort({ validFrom: 1 }).toArray()
    console.log(`DAS MEI em ${APP_DB}.${TAX_SETTINGS_COLLECTION}:`, all)
  } finally {
    await connection.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
