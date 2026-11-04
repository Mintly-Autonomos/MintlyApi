import { memberCreateRequestSchema, memberUpdateRequestSchema, MemberStatus, UserStatus } from 'mintly-lib'
import type { RestaurantMember } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { Resource } from '../../../core/types/resource'
import { logAudit } from '../../audit/audit-service'
import { AuthRepository } from '../../auth/auth-repository'
import { normalizeEmail } from '../../auth/normalize-email'
import { hashPassword } from '../../auth/password-hash'
import { requireOwner } from '../../auth/require-owner'
import { revokeAllSessions } from '../../auth/session-revocation'
import { readSubscriptionRecord } from '../../subscription/subscription-reader'
import { MAX_MEMBER_LOGINS, memberLimitError, memberLimitForTier } from './member-limits'
import { MemberRepository, toMember } from './member-repository'

/**
 * Garante que há vaga no plano do restaurante para mais um funcionário ATIVO (criar ou reativar). O plano vem
 * do restaurante do token (`subscription.tier`); o limite é por plano, em `member-limits.ts`.
 */
async function assertSeatAvailable (members: MemberRepository, ctx: RequestContext): Promise<void> {
  const { tier } = await readSubscriptionRecord(ctx.env, requireTenant(ctx).restaurantId)
  if (await members.countActive(ctx) >= memberLimitForTier(tier)) throw memberLimitError(tier)
}

/** GET /restaurants/me/members — só o dono. */
export class ListMembersQuery {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext): Promise<RestaurantMember[]> {
    await requireOwner(ctx, this.auth)
    return this.members.list(ctx)
  }
}

/** POST /restaurants/me/members — o dono cria o login de um funcionário (e-mail + senha). */
export class CreateMemberUseCase {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, body: unknown): Promise<RestaurantMember> {
    const owner = await requireOwner(ctx, this.auth)
    const input = memberCreateRequestSchema.parse(body ?? {}) as { name: string; email: string; password: string }
    const name = input.name.trim()
    if (name.length < 2) throw new ValidationError('O nome deve ter pelo menos 2 caracteres.')

    if (await this.members.count(ctx) >= MAX_MEMBER_LOGINS) {
      throw new ValidationError(`Um restaurante pode ter até ${MAX_MEMBER_LOGINS} logins de funcionário, ativos ou não.`)
    }
    await assertSeatAvailable(this.members, ctx)

    const member = await this.members.create(ctx, {
      name,
      email: normalizeEmail(input.email),
      passwordHash: hashPassword(input.password),
    })
    await logAudit('member_created', String(owner._id), ctx.env, owner.restaurantId, { memberId: member._id, email: member.email }).catch(() => null)
    return member
  }
}

/**
 * PATCH /restaurants/me/members/:id — o dono ativa/inativa o funcionário e/ou define uma senha nova. Inativar
 * ou trocar a senha derruba as sessões dele na hora (nenhum aparelho renova o acesso).
 */
export class UpdateMemberUseCase {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, id: string, body: unknown): Promise<RestaurantMember> {
    const owner = await requireOwner(ctx, this.auth)
    const changes = memberUpdateRequestSchema.parse(body ?? {}) as { status?: MemberStatus; password?: string }

    const member = await this.members.find(id, ctx)
    if (!member) throw new NotFoundError(Resource.Member, id)
    const memberId = String(member._id)

    // Reativar também ocupa uma vaga do plano (conferido antes de mudar qualquer coisa).
    if (changes.status === MemberStatus.Active && member.status !== UserStatus.Active) {
      await assertSeatAvailable(this.members, ctx)
    }

    const fields: string[] = []
    let endSessions = false
    if (changes.status !== undefined) {
      await this.members.setStatus(memberId, changes.status, ctx)
      fields.push('status')
      if (changes.status === MemberStatus.Inactive) endSessions = true
    }
    if (changes.password !== undefined) {
      await this.auth.updatePassword(memberId, hashPassword(changes.password), ctx)
      fields.push('password')
      endSessions = true
    }

    if (endSessions) await revokeAllSessions(memberId, ctx, 'member_updated')
    if (fields.length > 0) {
      await logAudit('member_updated', String(owner._id), ctx.env, owner.restaurantId, { memberId, fields }).catch(() => null)
    }

    const fresh = await this.members.find(id, ctx)
    return toMember(fresh ?? member)
  }
}
