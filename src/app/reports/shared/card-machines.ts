import { Db } from 'mongodb'
import { FinancialAccountType, PlatformKind } from 'mintly-lib'

/**
 * Ids das contas plataforma que são maquininha (S3.3). A taxa delas é "taxa da maquininha" (não comissão de
 * app) e a venda nelas é salão. Vale o tipo ATUAL da conta: corrigir o tipo corrige o histórico. O lançamento
 * guarda `account._id` como texto.
 */
export async function cardMachineAccountIds (db: Db, restaurantId: string | undefined): Promise<string[]> {
  const docs = await db.collection('financial_accounts')
    .find({ restaurantId, type: FinancialAccountType.Platform, platformKind: PlatformKind.CardMachine }, { projection: { _id: 1 } })
    .toArray()
  return docs.map((d) => String(d._id))
}
