import { Collection, Document } from 'mongodb'

/**
 * Índices da collection `ai_usage` (contador diário de chamadas à IA, um documento por restaurante e dia).
 * O documento só interessa no dia; o TTL apaga os antigos sozinho.
 */
export const collection = 'ai_usage'

export async function ensure (col: Collection<Document>): Promise<void> {
  // `expireAt` é gravado como a virada para depois do dia (com folga): o Mongo remove o documento ao passar dela.
  await col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
}
