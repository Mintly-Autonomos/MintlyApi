import { ObjectId } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'

/** Restaurante do usuário autenticado — o id vem SEMPRE do token (ctx.restaurantId). */
export class RestaurantRepository {
  private col (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection('restaurants')
  }

  private id (ctx: RequestContext): ObjectId {
    if (!ctx.restaurantId || !ObjectId.isValid(ctx.restaurantId)) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return new ObjectId(ctx.restaurantId)
  }

  async findMine (ctx: RequestContext): Promise<any> {
    const doc = await this.col(ctx).findOne({ _id: this.id(ctx) })
    if (!doc) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return doc
  }

  /**
   * Carimba o primeiro acesso (conclusão do onboarding) com a hora do servidor. Só mexe em quem tem o
   * campo VAZIO (`null`, como o cadastro grava): repetir não muda a data e restaurante antigo (sem o
   * campo) fica como está. Devolve o restaurante em qualquer caso.
   */
  async completeFirstAccess (ctx: RequestContext, now: Date): Promise<any> {
    await this.col(ctx).updateOne(
      { _id: this.id(ctx), firstAccessAt: { $type: 'null' } },
      { $set: { firstAccessAt: now, 'audit.updatedAt': now, 'audit.updatedBy': ctx.userId } },
    )
    return this.findMine(ctx)
  }

  /** Registra o pedido de exclusão (só o pedido: nada é apagado). */
  async setDeletionRequested (ctx: RequestContext, now: Date): Promise<void> {
    await this.col(ctx).updateOne(
      { _id: this.id(ctx) },
      { $set: { deletionRequestedAt: now, 'audit.updatedAt': now, 'audit.updatedBy': ctx.userId } },
    )
  }

  async clearDeletionRequested (ctx: RequestContext): Promise<void> {
    await this.col(ctx).updateOne(
      { _id: this.id(ctx) },
      { $unset: { deletionRequestedAt: '' }, $set: { 'audit.updatedAt': new Date(), 'audit.updatedBy': ctx.userId } },
    )
  }

  async updateMine (ctx: RequestContext, set: Record<string, unknown>): Promise<any> {
    const doc = await this.col(ctx).findOneAndUpdate({ _id: this.id(ctx) }, { $set: set }, { returnDocument: 'after' })
    if (!doc) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return doc
  }
}
