import { timingSafeEqual } from 'crypto'
import { ObjectId } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { ValidationError } from '../../core/errors/core/validation-error'
import { UnauthorizedError } from '../../core/errors/auth/unauthorized-error'
import { AuthRepository } from '../auth/auth-repository'
import { normalizeEmail } from '../auth/normalize-email'

/** O presente vale 1 dia: de agora até amanhã, na mesma hora. Não existe parâmetro para mudar isso. */
export const GIFT_DURATION_MS = 24 * 60 * 60 * 1000

export type GiftResult =
  | { granted: true, endsAt: Date }
  | { granted: false, endsAt: Date }

/** Compara a chave enviada com a configurada sem vazar nada por tempo de resposta. */
export function adminKeyMatches (sent: unknown, configured: string): boolean {
  if (typeof sent !== 'string') return false
  const a = Buffer.from(sent)
  const b = Buffer.from(configured)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * POST /admin/subscription-gift — presente de acesso por UM dia, para testar ou ajudar alguém.
 *
 * Só funciona com a chave de administrador (ADMIN_API_KEY): sem ela configurada a rota nem existe (404),
 * e com chave errada responde 401. O presente SEMPRE termina em agora + 24h e nunca encurta nem
 * estende uma assinatura que já vá além disso: quem já tem mais de um dia não recebe nada.
 * Não mexe no tipo da assinatura nem cria pagamento.
 */
export class GiftSubscriptionUseCase {
  constructor (private readonly authRepo: AuthRepository = new AuthRepository()) {}

  async execute (input: { email: unknown }, sentKey: unknown, ctx: RequestContext, now: Date = new Date(), configuredKey: string | undefined = process.env.ADMIN_API_KEY): Promise<GiftResult> {
    if (!configuredKey) throw new NotFoundError('route', 'admin/subscription-gift')
    if (!adminKeyMatches(sentKey, configuredKey)) throw new UnauthorizedError()

    if (typeof input?.email !== 'string' || !input.email.trim()) {
      throw new ValidationError('Informe o email da conta que vai receber o presente.')
    }
    const user = await this.authRepo.findByEmail(normalizeEmail(input.email), ctx)
    if (!user?.restaurantId || !ObjectId.isValid(user.restaurantId)) {
      throw new NotFoundError('users', input.email)
    }

    const until = new Date(now.getTime() + GIFT_DURATION_MS)
    const restaurants = MongoDBConnection.getInstance().getDatabase(ctx.env).collection('restaurants')
    const _id = new ObjectId(user.restaurantId)

    // Atômico: só grava se ainda não houver assinatura que vá além do presente (nada de encurtar ou somar).
    const granted = await restaurants.findOneAndUpdate(
      { _id, $or: [{ 'subscription.endsAt': { $exists: false } }, { 'subscription.endsAt': { $lt: until } }] },
      { $set: { 'subscription.endsAt': until, 'subscription.giftedAt': now, 'subscription.updatedAt': now } },
    )
    if (granted) {
      console.log(`Presente de 1 dia: restaurante ${user.restaurantId} (${ctx.env}) até ${until.toISOString()}.`)
      return { granted: true, endsAt: until }
    }

    const current = await restaurants.findOne({ _id }, { projection: { 'subscription.endsAt': 1 } })
    if (!current) throw new NotFoundError('restaurants', user.restaurantId)
    return { granted: false, endsAt: new Date(current.subscription.endsAt) }
  }
}
