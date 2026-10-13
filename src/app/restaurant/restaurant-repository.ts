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

  async updateMine (ctx: RequestContext, set: Record<string, unknown>): Promise<any> {
    const doc = await this.col(ctx).findOneAndUpdate({ _id: this.id(ctx) }, { $set: set }, { returnDocument: 'after' })
    if (!doc) throw new NotFoundError(Resource.Restaurant, ctx.restaurantId)
    return doc
  }
}
