import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `payments` (cobranças da assinatura).
 *
 * Fonte única dos índices desta collection: para ADICIONAR ou REMOVER um índice, edite só este
 * arquivo. `createIndex` é idempotente, então o runner pode rodar isto a cada deploy.
 */
export const collection = 'payments'

export async function ensure (col: Collection<Document>): Promise<void> {
  // O mesmo pagamento do provedor nunca vale para duas cobranças nossas (parcial: só quando já tem id).
  await col.createIndex(
    { providerPaymentId: 1 },
    { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string' } } },
  )

  // Histórico de cobranças de um restaurante, da mais recente para a mais antiga.
  await col.createIndex({ restaurantId: 1, createdAt: -1 })
}
