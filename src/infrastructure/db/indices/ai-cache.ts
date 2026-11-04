import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `ai_cache` (textos que a IA já escreveu para os mesmos dados no mesmo dia, para a
 * mesma tela não gastar uma chamada do limite diário a cada recarga). Expira sozinho.
 */
export const collection = 'ai_cache'

export async function ensure (col: Collection<Document>): Promise<void> {
  await col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
}
