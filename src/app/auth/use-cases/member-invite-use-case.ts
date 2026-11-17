import { ObjectId } from 'mongodb'
import { UserRole, UserStatus } from 'mintly-lib'
import type { InvitePreview } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../../core/context/request-context'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { logAudit } from '../../audit/audit-service'
import { MemberInviteRepository } from '../../restaurant/members/member-invite-repository'
import { restaurantName, sha256 } from '../../restaurant/members/member-invite-service'
import { hashPassword } from '../password-hash'
import { resetPasswordSchema, throwFieldError } from '../password-recovery-schema'
import { revokeAllSessions } from '../session-revocation'

/** Mensagem única para token inválido, usado, vencido ou de funcionário que não está mais convidado. */
const INVALID = 'Convite inválido ou vencido. Peça ao dono para reenviar.'

/**
 * Aceite do convite de funcionário (E.1), pelas rotas públicas `/auth/invite/*`: o token do e-mail é a
 * credencial. Só vale para usuário `member` ainda `invited` (inativado ou excluído depois → inválido).
 */
export class MemberInviteUseCase {
  private users (ctx: RequestContext) {
    return MongoDBConnection.getInstance().getDatabase(ctx.env).collection('users')
  }

  private async invitedUser (userId: string, ctx: RequestContext) {
    if (!ObjectId.isValid(userId)) return null
    const user = await this.users(ctx).findOne({ _id: new ObjectId(userId) })
    return user && user.role === UserRole.Member && user.status === UserStatus.Invited ? user : null
  }

  /** POST /auth/invite/preview — para quem é o convite; não consome o token. */
  async preview (body: { token?: unknown } | undefined, ctx: RequestContext): Promise<InvitePreview> {
    const token = typeof body?.token === 'string' ? body.token : ''
    if (!token) throw new UnauthorizedError(INVALID)
    const invite = await new MemberInviteRepository(ctx.env).findValid(sha256(token))
    const user = invite ? await this.invitedUser(invite.userId, ctx) : null
    if (!invite || !user) throw new UnauthorizedError(INVALID)
    return {
      name: user.person?.name ?? '',
      email: user.email,
      restaurantName: await restaurantName(ctx.env, invite.restaurantId),
      expiresAt: invite.expiresAt,
    }
  }

  /** POST /auth/invite/accept — cria a senha (mesma política do cadastro) e ativa o login. Uso único. */
  async accept (body: unknown, ctx: RequestContext): Promise<void> {
    const input = resetPasswordSchema.parse(body ?? {})
    if (input.newPassword !== input.confirmNewPassword) {
      throwFieldError('confirmNewPassword', 'As senhas não conferem.')
    }
    // Claim atômico: queima o token antes de qualquer outra coisa (fail-closed, como na recuperação).
    const invite = await new MemberInviteRepository(ctx.env).claim(sha256(input.token))
    const user = invite ? await this.invitedUser(invite.userId, ctx) : null
    if (!invite || !user) throw new UnauthorizedError(INVALID)

    const now = new Date()
    const updated = await this.users(ctx).updateOne(
      { _id: user._id, status: UserStatus.Invited },
      { $set: { passwordHash: hashPassword(input.newPassword), status: UserStatus.Active, inviteAcceptedAt: now, 'audit.updatedAt': now, 'audit.updatedBy': String(user._id) } },
    )
    if (updated.modifiedCount !== 1) throw new UnauthorizedError(INVALID)
    await revokeAllSessions(String(user._id), ctx, 'invite_accepted')
    await logAudit('member_invite_accepted', String(user._id), ctx.env, user.restaurantId, {}).catch(() => null)
  }
}
