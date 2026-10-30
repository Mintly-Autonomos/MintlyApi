import { ObjectId } from 'mongodb'
import { DEFAULT_SUBSCRIPTION_TIER, SUBSCRIPTION_PLAN_DAYS, computeSubscriptionState } from 'mintly-lib'
import type { SubscriptionRecurring, SubscriptionState, SubscriptionTier } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'

/**
 * Data limite da assinatura do restaurante: `restaurants.subscription.endsAt`.
 * É o único campo que o acesso exige. Para liberar uma conta à mão, basta gravá-lo no restaurante:
 * db.restaurants.updateOne({ _id: ObjectId("…") }, { $set: { "subscription.endsAt": ISODate("2027-01-01") } })
 * O tipo (`subscription.tier`: "basic" | "pro") é opcional: sem ele a conta conta como Básico.
 */
export async function readSubscriptionRecord (
  env: string,
  restaurantId: string | undefined,
): Promise<{ endsAt: Date | null, tier: SubscriptionTier | undefined }> {
  if (!restaurantId || !ObjectId.isValid(restaurantId)) return { endsAt: null, tier: undefined }
  const doc = await MongoDBConnection.getInstance()
    .getDatabase(env)
    .collection('restaurants')
    .findOne({ _id: new ObjectId(restaurantId) }, { projection: { 'subscription.endsAt': 1, 'subscription.tier': 1 } })
  const raw = doc?.subscription?.endsAt
  const tier = doc?.subscription?.tier as SubscriptionTier | undefined
  if (!raw) return { endsAt: null, tier }
  const d = raw instanceof Date ? raw : new Date(raw)
  return { endsAt: Number.isNaN(d.getTime()) ? null : d, tier }
}

/** Renovação automática de um restaurante, como o app mostra (`null` = nunca houve). */
export async function readRecurring (env: string, restaurantId: string | undefined): Promise<SubscriptionRecurring | null> {
  if (!restaurantId || !ObjectId.isValid(restaurantId)) return null
  const doc = await MongoDBConnection.getInstance()
    .getDatabase(env)
    .collection('restaurants')
    .findOne({ _id: new ObjectId(restaurantId) }, { projection: { 'subscription.recurring': 1 } })
  const r = doc?.subscription?.recurring
  if (!r?.preapprovalId) return null
  const months = r.months as keyof typeof SUBSCRIPTION_PLAN_DAYS
  return {
    status: r.status,
    tier: r.tier ?? DEFAULT_SUBSCRIPTION_TIER,
    months,
    days: SUBSCRIPTION_PLAN_DAYS[months] ?? 0,
    startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
  }
}

export async function readSubscriptionEndsAt (env: string, restaurantId: string | undefined): Promise<Date | null> {
  return (await readSubscriptionRecord(env, restaurantId)).endsAt
}

export async function readSubscriptionState (env: string, restaurantId: string | undefined, now: Date = new Date()): Promise<SubscriptionState> {
  const { endsAt, tier } = await readSubscriptionRecord(env, restaurantId)
  return computeSubscriptionState(endsAt, now, tier)
}
