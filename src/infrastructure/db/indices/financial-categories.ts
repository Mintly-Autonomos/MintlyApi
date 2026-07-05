import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `financial_categories` (MIN-71).
 *
 * Fonte única de verdade dos índices desta collection: para ADICIONAR ou
 * REMOVER um índice, edite só este arquivo. `createIndex` é idempotente, então
 * o runner pode rodar isto a cada deploy sem custo quando o índice já existe.
 */
export const collection = 'financial_categories'

export async function ensure (col: Collection<Document>): Promise<void> {
  // Duplicidade name+type por restaurante (case/acento-insensitive) -> 409 no insert.
  await col.createIndex(
    { restaurantId: 1, name: 1, type: 1 },
    { unique: true, collation: { locale: 'pt', strength: 2 } },
  )

  // Listagem/busca por status dentro do restaurante.
  await col.createIndex({ restaurantId: 1, status: 1 })

  // Suporta SuggestCategoriesQuery: filtra por restaurante+tipo+status (equality),
  // ordena por recência (lastUsedAt) + frequência (usage).
  await col.createIndex({ restaurantId: 1, type: 1, status: 1, lastUsedAt: -1, usage: -1 })
}
