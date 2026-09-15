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
  // A query de duplicidade filtra por `audit.createdAt` (não `createdAt` de topo).
  await col.createIndex({ restaurantId: 1, 'account._id': 1, title: 1, 'audit.createdAt': -1 })

  // Query do settler (P1): pendentes vencidos, CROSS-TENANT (sem restaurantId —
  // o job varre todos os restaurantes do ambiente numa tacada).
  await col.createIndex({ status: 1, predictedReceiptDate: 1 })
}
