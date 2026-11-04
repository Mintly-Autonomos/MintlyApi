import { AiUsage, AI_DAILY_LIMIT } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { requireTenant } from '../../core/context/require-tenant'
import { AiLimitReachedError } from './ai-errors'
import { dayKey } from './ai-text-rules'

const DAY_MS = 86_400_000

/**
 * Contador diário de chamadas à IA (por restaurante) e cache dos textos já escritos. Tudo escopado pelo
 * restaurante do token. O contador usa uma escrita atômica: duas chamadas ao mesmo tempo não passam do limite.
 */
export class AiRepository {
  private db (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env)
  }

  private usageOf (count: number, limit: number): AiUsage {
    const usedToday = Math.min(count, limit)
    return { limitPerDay: limit, usedToday, remainingToday: Math.max(0, limit - usedToday) }
  }

  /** Uso de hoje, sem gastar chamada. */
  async usage (ctx: RequestContext, now: Date, limit: number = AI_DAILY_LIMIT): Promise<AiUsage> {
    const { restaurantId } = requireTenant(ctx)
    const doc = await this.db(ctx).collection('ai_usage').findOne({ _id: `${restaurantId}:${dayKey(now)}` as any })
    return this.usageOf(Number(doc?.count ?? 0), limit)
  }

  /** Gasta UMA chamada do dia. `AiLimitReachedError` (429) quando já chegou no limite. */
  async reserve (ctx: RequestContext, now: Date, limit: number = AI_DAILY_LIMIT): Promise<AiUsage> {
    const { restaurantId } = requireTenant(ctx)
    const day = dayKey(now)
    try {
      const doc = await this.db(ctx).collection('ai_usage').findOneAndUpdate(
        { _id: `${restaurantId}:${day}` as any, count: { $lt: limit } },
        {
          $inc: { count: 1 },
          $set: { updatedAt: now },
          // some sozinho (TTL) bem depois do dia acabar
          $setOnInsert: { restaurantId, day, expireAt: new Date(now.getTime() + 3 * DAY_MS) },
        },
        { upsert: true, returnDocument: 'after' },
      )
      return this.usageOf(Number(doc?.count ?? 1), limit)
    } catch (error) {
      // Já existe o documento do dia e o contador está no limite: o upsert tentou inserir o mesmo _id.
      if ((error as { code?: number })?.code === 11000) throw new AiLimitReachedError(limit)
      throw error
    }
  }

  /** Devolve a chamada gasta quando a IA falhou (falha da IA não custa limite). */
  async release (ctx: RequestContext, now: Date): Promise<void> {
    const { restaurantId } = requireTenant(ctx)
    await this.db(ctx).collection('ai_usage').updateOne(
      { _id: `${restaurantId}:${dayKey(now)}` as any, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    ).catch(() => null)
  }

  /** Texto já escrito para estes mesmos dados hoje (ou `null`). */
  async cacheGet<T> (ctx: RequestContext, kind: string, hash: string, now: Date): Promise<T | null> {
    const { restaurantId } = requireTenant(ctx)
    const doc = await this.db(ctx).collection('ai_cache').findOne({ _id: `${restaurantId}:${kind}:${dayKey(now)}:${hash}` as any })
    return (doc?.payload as T | undefined) ?? null
  }

  async cacheSet (ctx: RequestContext, kind: string, hash: string, payload: unknown, now: Date): Promise<void> {
    const { restaurantId } = requireTenant(ctx)
    await this.db(ctx).collection('ai_cache').updateOne(
      { _id: `${restaurantId}:${kind}:${dayKey(now)}:${hash}` as any },
      { $set: { restaurantId, kind, payload, createdAt: now, expireAt: new Date(now.getTime() + 2 * DAY_MS) } },
      { upsert: true },
    ).catch(() => null) // cache é só economia: falhar aqui não derruba o texto
  }
}
