import { Collection, Document, MongoServerError } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { ImportMovementsResult } from 'mintly-lib'

export const IMPORT_COLLECTION = 'movement_imports'

export interface MovementImportDoc {
  restaurantId: string
  key: string
  status: 'processing' | 'done'
  createdAt: Date
  result?: ImportMovementsResult
}

/**
 * Guarda a chave de idempotência de cada importação (por restaurante). O índice único
 * (restaurantId + key) é quem impede duas importações iguais ao mesmo tempo; o TTL apaga a chave
 * depois de um tempo, para o mesmo arquivo poder ser importado de novo bem depois. Os índices
 * ficam em `infrastructure/db/indices/movement-imports.ts`.
 */
export class MovementImportRepository {
  private collection (ctx: RequestContext): Collection<Document> {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection(IMPORT_COLLECTION)
  }

  /**
   * Reserva a chave. `true` = reservou (pode importar); `false` = a chave já existe.
   * Só o erro de chave duplicada vira `false`; qualquer outro sobe.
   */
  async reserve (key: string, ctx: RequestContext): Promise<boolean> {
    try {
      await this.collection(ctx).insertOne({ restaurantId: ctx.restaurantId, key, status: 'processing', createdAt: new Date() })
      return true
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return false
      throw error
    }
  }

  async find (key: string, ctx: RequestContext): Promise<MovementImportDoc | null> {
    const doc = await this.collection(ctx).findOne({ restaurantId: ctx.restaurantId, key })
    return doc as unknown as MovementImportDoc | null
  }

  async complete (key: string, result: ImportMovementsResult, ctx: RequestContext): Promise<void> {
    await this.collection(ctx).updateOne({ restaurantId: ctx.restaurantId, key }, { $set: { status: 'done', result } })
  }

  /** Libera a chave quando nada foi gravado (ex.: falha antes da 1ª linha): permite tentar de novo. */
  async release (key: string, ctx: RequestContext): Promise<void> {
    await this.collection(ctx).deleteOne({ restaurantId: ctx.restaurantId, key, status: 'processing' })
  }
}
