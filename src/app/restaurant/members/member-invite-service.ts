import { createHash, randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'
import { MEMBER_INVITE_EXPIRY_DAYS } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { getEmailService } from '../../../infrastructure/email/email-service'
import { MemberInviteRepository } from './member-invite-repository'

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Nome do restaurante para o e-mail e para a tela do convite. */
export async function restaurantName (env: string, restaurantId: string): Promise<string> {
  if (!ObjectId.isValid(restaurantId)) return ''
  const doc = await MongoDBConnection.getInstance().getDatabase(env).collection('restaurants')
    .findOne({ _id: new ObjectId(restaurantId) }, { projection: { name: 1 } })
  return doc?.name ?? ''
}

/**
 * Gera um convite novo para o funcionário (o anterior deixa de valer) e manda o e-mail. Uma falha no envio
 * não desfaz o convite: o dono vê o funcionário como "Convite enviado" e pode reenviar. Devolve a validade.
 */
export async function issueInvite (
  env: string,
  member: { userId: string; restaurantId: string; email: string; name: string },
): Promise<Date> {
  const repo = new MemberInviteRepository(env)
  await repo.invalidateAllForUser(member.userId)
  const token = randomBytes(32).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + MEMBER_INVITE_EXPIRY_DAYS * 86_400_000)
  await repo.create({ token: sha256(token), userId: member.userId, restaurantId: member.restaurantId, expiresAt, usedAt: null, createdAt: now })
  const restaurant = await restaurantName(env, member.restaurantId)
  await getEmailService()
    .sendMemberInvite(member.email, token, { memberName: member.name, restaurantName: restaurant, expiresInDays: MEMBER_INVITE_EXPIRY_DAYS })
    .catch((err) => console.error('[CONVITE] Falha ao enviar e-mail:', err))
  return expiresAt
}
