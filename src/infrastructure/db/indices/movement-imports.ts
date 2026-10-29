import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `movement_imports` (chaves de idempotência da importação em massa).
 *
 * Fonte única dos índices desta collection: para ADICIONAR ou REMOVER um índice, edite só este
 * arquivo. `createIndex` é idempotente, então o runner pode rodar isto a cada deploy.
 */
export const collection = 'movement_imports'

export async function ensure (col: Collection<Document>): Promise<void> {
  // Uma chave por restaurante: é ele que impede duas importações iguais ao mesmo tempo.
  await col.createIndex({ restaurantId: 1, key: 1 }, { unique: true })

  // A chave expira em 30 dias, para o mesmo arquivo poder ser importado de novo bem depois.
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 })
}
