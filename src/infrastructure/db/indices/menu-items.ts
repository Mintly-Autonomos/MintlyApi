import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `menu_items` (cardápio).
 *
 * Fonte única dos índices desta collection: para ADICIONAR ou REMOVER um índice, edite só este
 * arquivo. `createIndex` é idempotente, então o runner pode rodar isto a cada deploy.
 */
export const collection = 'menu_items'

export async function ensure (col: Collection<Document>): Promise<void> {
  // Nome único por restaurante (case/acento-insensitive) -> 409 no insert.
  await col.createIndex(
    { restaurantId: 1, name: 1 },
    { unique: true, collation: { locale: 'pt', strength: 2 } },
  )

  // Suporta GET /price-alerts: ativos do restaurante, do mais antigo revisado para o mais novo.
  await col.createIndex({ restaurantId: 1, status: 1, priceReviewedAt: 1 })
}
