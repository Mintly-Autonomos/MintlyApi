import { ObjectId } from 'mongodb'
import { computeSubscriptionState } from 'mintly-lib'
import type { SubscriptionState } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'

/**
 * Data limite da assinatura do restaurante: `restaurants.subscription.endsAt`.
 * É o único campo que o acesso exige. Para liberar uma conta à mão, basta gravá-lo no restaurante:
 * db.restaurants.updateOne({ _id: ObjectId("…") }, { $set: { "subscription.endsAt": ISODate("2027-01-01") } })
 */
export async function readSubscriptionEndsAt (env: string, restaurantId: string | undefined): Promise<Date | null> {
  if (!restaurantId || !ObjectId.isValid(restaurantId)) return null
  const doc = await MongoDBConnection.getInstance()
    .getDatabase(env)
    .collection('restaurants')
    .findOne({ _id: new ObjectId(restaurantId) }, { projection: { 'subscription.endsAt': 1 } })
  const raw = doc?.subscription?.endsAt
  if (!raw) return null
  const d = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function readSubscriptionState (env: string, restaurantId: string | undefined, now: Date = new Date()): Promise<SubscriptionState> {
  return computeSubscriptionState(await readSubscriptionEndsAt(env, restaurantId), now)
}
