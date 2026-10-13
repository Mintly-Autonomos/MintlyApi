import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { APP_DB } from '../environment/env-allowlist'

/** Configuração tributária global, no banco `app` (um por cluster). */
export const TAX_SETTINGS_COLLECTION = 'tax_settings'

/**
 * DAS do MEI vigente num mês: o documento com o maior `validFrom` (`AAAA-MM`,
 * comparável como string) até o mês. Semeado por `npm run db:seed-tax-settings`
 * — o valor muda todo ano e nunca fica no código (MIN-23).
 */
export class TaxSettingsRepository {
  async meiMonthlyDasAt (month: string): Promise<number | null> {
    const doc = await MongoDBConnection.getInstance().getDatabase(APP_DB).collection(TAX_SETTINGS_COLLECTION)
      .find({ validFrom: { $lte: month } })
      .sort({ validFrom: -1 })
      .limit(1)
      .next()
    return doc?.meiMonthlyDas ?? null
  }
}
