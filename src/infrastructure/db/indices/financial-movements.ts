import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `financial_movements` (MIN-49/50).
 * Fonte única — editar aqui pra add/remover índice. `createIndex` é idempotente.
 */
export const collection = 'financial_movements'

export async function ensure (col: Collection<Document>): Promise<void> {
  // Listagem: mais recente -> antiga por data, dentro do restaurante.
  await col.createIndex({ restaurantId: 1, date: -1 })

  // Filtro por status/direção dentro do restaurante.
  await col.createIndex({ restaurantId: 1, status: 1 })

  // Detecção de duplicidade (mesmo restaurante/conta/título/valor em janela curta).
  await col.createIndex({ restaurantId: 1, 'account._id': 1, title: 1, createdAt: -1 })
}
