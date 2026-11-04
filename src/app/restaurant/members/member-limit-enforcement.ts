import { ObjectId } from 'mongodb'
import { UserRole, UserStatus } from 'mintly-lib'
import type { SubscriptionTier } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { logAudit } from '../../audit/audit-service'
import { revokeAllSessions } from '../../auth/session-revocation'
import { memberLimitForTier } from './member-limits'

/**
 * Quando o plano do restaurante cai (ex.: Pro -> Básico) e há mais funcionários ATIVOS do que o novo plano
 * permite, inativa o excedente: os mais RECENTES primeiro (ficam os mais antigos). Quem foi inativado perde as
 * sessões na hora (nenhum aparelho renova o acesso). O dono pode reativar qualquer um quando houver vaga
 * (inativando outro ou subindo de plano); a reativação passa pela mesma checagem de vagas.
 *
 * Devolve os ids inativados. Não deve derrubar quem chamou: o pagamento já foi aceito, e a criação/reativação
 * continuam barradas pelo limite mesmo que isto falhe.
 */
export async function enforceMemberLimit (
  env: string,
  restaurantId: string,
  tier: SubscriptionTier | undefined,
  actorUserId: string,
): Promise<string[]> {
  const limit = memberLimitForTier(tier)
  const db = MongoDBConnection.getInstance().getDatabase(env)
  const filter = { restaurantId, role: UserRole.Member, status: UserStatus.Active }

  const active = await db.collection('users')
    .find(filter, { projection: { _id: 1 } })
    .sort({ 'audit.createdAt': -1, _id: -1 }) // os mais recentes primeiro
    .toArray()
  const excess = active.slice(0, Math.max(0, active.length - limit)).map((u) => u._id as ObjectId)
  if (excess.length === 0) return []

  const now = new Date()
  await db.collection('users').updateMany(
    { _id: { $in: excess }, ...filter },
    { $set: { status: UserStatus.Inactive, 'audit.updatedAt': now, 'audit.updatedBy': 'subscription' } },
  )
  const ids = excess.map(String)
  for (const id of ids) await revokeAllSessions(id, { env }, 'plan_downgrade')
  await logAudit('members_deactivated_by_plan', actorUserId, env, restaurantId, { memberIds: ids, limit, tier }).catch(() => null)
  return ids
}
