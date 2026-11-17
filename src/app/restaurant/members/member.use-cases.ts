import { memberCreateRequestSchema, memberUpdateRequestSchema, MemberProfile, MemberStatus, UserStatus } from 'mintly-lib'
import type { RestaurantMember } from 'mintly-lib'
import type { Document } from 'mongodb'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { Resource } from '../../../core/types/resource'
import { logAudit } from '../../audit/audit-service'
import { AuthRepository } from '../../auth/auth-repository'
import { normalizeEmail } from '../../auth/normalize-email'
import { requireOwner } from '../../auth/require-owner'
import { revokeAllSessions } from '../../auth/session-revocation'
import { readSubscriptionRecord } from '../../subscription/subscription-reader'
import { MAX_MEMBER_LOGINS, memberLimitError, memberLimitForTier } from './member-limits'
import { MemberInviteRepository } from './member-invite-repository'
import { issueInvite } from './member-invite-service'
import { MemberRepository, toMember } from './member-repository'

/**
 * Garante que há vaga no plano do restaurante para mais um funcionário (convidar ou reativar). O plano vem
 * do restaurante do token (`subscription.tier`); o limite é por plano, em `member-limits.ts`. Convite pendente
 * ocupa vaga.
 */
async function assertSeatAvailable (members: MemberRepository, ctx: RequestContext): Promise<void> {
  const { tier } = await readSubscriptionRecord(ctx.env, requireTenant(ctx).restaurantId)
  if (await members.countActive(ctx) >= memberLimitForTier(tier)) throw memberLimitError(tier)
}

const cleanName = (raw: string): string => {
  const name = raw.trim()
  if (name.length < 2) throw new ValidationError('O nome deve ter pelo menos 2 caracteres.')
  return name
}

/** Convite do funcionário, com o restaurante do token. */
const inviteFor = (ctx: RequestContext, doc: Document) =>
  issueInvite(ctx.env, { userId: String(doc._id), restaurantId: requireTenant(ctx).restaurantId, email: doc.email, name: doc.person?.name ?? '' })

/** GET /restaurants/me/members — só o dono. Convidados trazem a validade do convite. */
export class ListMembersQuery {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext): Promise<RestaurantMember[]> {
    await requireOwner(ctx, this.auth)
    const invites = new MemberInviteRepository(ctx.env)
    return this.members.list(ctx, (ids) => invites.pendingExpiries(ids))
  }
}

/**
 * POST /restaurants/me/members — o dono convida um funcionário (nome, e-mail e perfil; sem senha). O
 * funcionário recebe o link por e-mail e cria a própria senha (E.1). Sem perfil, vale Operação.
 */
export class CreateMemberUseCase {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, body: unknown): Promise<RestaurantMember> {
    const owner = await requireOwner(ctx, this.auth)
    const input = memberCreateRequestSchema.parse(body ?? {}) as { name: string; email: string; profile?: MemberProfile }
    const name = cleanName(input.name)

    if (await this.members.count(ctx) >= MAX_MEMBER_LOGINS) {
      throw new ValidationError(`Um restaurante pode ter até ${MAX_MEMBER_LOGINS} logins de funcionário, ativos ou não.`)
    }
    await assertSeatAvailable(this.members, ctx)

    const doc = await this.members.create(ctx, { name, email: normalizeEmail(input.email), profile: input.profile ?? MemberProfile.Operations })
    const expiresAt = await inviteFor(ctx, doc)
    await logAudit('member_invited', String(owner._id), ctx.env, owner.restaurantId, { memberId: String(doc._id), email: doc.email, profile: doc.memberProfile }).catch(() => null)
    return toMember(doc, expiresAt)
  }
}

/**
 * PATCH /restaurants/me/members/:id — o dono ativa/inativa, muda nome, e-mail e perfil (E.2, E.3).
 * - Inativar derruba as sessões na hora; inativar um convidado cancela o convite.
 * - Reativar ocupa vaga do plano. Quem nunca criou a senha volta como convidado, com convite novo.
 * - Trocar o e-mail de quem já entra derruba as sessões; de um convidado, manda o convite para o novo.
 * - O perfil vale no pedido seguinte (a API lê o perfil do banco a cada pedido).
 */
export class UpdateMemberUseCase {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, id: string, body: unknown): Promise<RestaurantMember> {
    const owner = await requireOwner(ctx, this.auth)
    const changes = memberUpdateRequestSchema.parse(body ?? {}) as { status?: MemberStatus; name?: string; email?: string; profile?: MemberProfile }
    if (changes.status === MemberStatus.Invited) {
      throw new ValidationError('Para mandar o convite de novo, use "Reenviar convite".')
    }

    const member = await this.members.find(id, ctx)
    if (!member) throw new NotFoundError(Resource.Member, id)
    const memberId = String(member._id)
    const wasInvited = member.status === UserStatus.Invited
    const hasPassword = typeof member.passwordHash === 'string' && member.passwordHash !== ''

    const fields: string[] = []
    let endSessions = false
    let sendInvite = false

    // Reativar também ocupa uma vaga do plano (conferido antes de mudar qualquer coisa).
    const activating = changes.status === MemberStatus.Active && member.status === UserStatus.Inactive
    if (activating) await assertSeatAvailable(this.members, ctx)

    const name = changes.name !== undefined ? cleanName(changes.name) : undefined
    const email = changes.email !== undefined ? normalizeEmail(changes.email) : undefined
    const emailChanged = email !== undefined && email !== member.email
    const fieldChanges = {
      ...(name !== undefined && name !== member.person?.name ? { name } : {}),
      ...(emailChanged ? { email } : {}),
      ...(changes.profile !== undefined ? { profile: changes.profile } : {}),
    }
    if (Object.keys(fieldChanges).length > 0) {
      await this.members.updateFields(member, fieldChanges, ctx)
      fields.push(...Object.keys(fieldChanges))
      if (emailChanged) {
        if (wasInvited) sendInvite = true
        else endSessions = true
      }
    }

    if (changes.status === MemberStatus.Inactive && member.status !== UserStatus.Inactive) {
      await this.members.setStatus(memberId, UserStatus.Inactive, ctx)
      await new MemberInviteRepository(ctx.env).invalidateAllForUser(memberId)
      fields.push('status')
      endSessions = true
      sendInvite = false
    } else if (activating) {
      await this.members.setStatus(memberId, hasPassword ? UserStatus.Active : UserStatus.Invited, ctx)
      fields.push('status')
      if (!hasPassword) sendInvite = true
    }

    if (endSessions) await revokeAllSessions(memberId, ctx, 'member_updated')
    const fresh = (await this.members.find(id, ctx)) ?? member
    let expiresAt: Date | undefined
    if (sendInvite) expiresAt = await inviteFor(ctx, fresh)
    if (fields.length > 0) {
      await logAudit('member_updated', String(owner._id), ctx.env, owner.restaurantId, { memberId, fields }).catch(() => null)
    }
    if (!expiresAt && fresh.status === UserStatus.Invited) {
      expiresAt = (await new MemberInviteRepository(ctx.env).pendingExpiries([memberId])).get(memberId)
    }
    return toMember(fresh, expiresAt)
  }
}

/** POST /restaurants/me/members/:id/invite — reenvia o convite (link novo; o anterior deixa de valer). */
export class ResendInviteUseCase {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, id: string): Promise<RestaurantMember> {
    const owner = await requireOwner(ctx, this.auth)
    const member = await this.members.find(id, ctx)
    if (!member) throw new NotFoundError(Resource.Member, id)
    if (member.status !== UserStatus.Invited) {
      throw new ConflictError('Este funcionário já criou a senha: não há convite para reenviar.')
    }
    const expiresAt = await inviteFor(ctx, member)
    await logAudit('member_invite_resent', String(owner._id), ctx.env, owner.restaurantId, { memberId: id }).catch(() => null)
    return toMember(member, expiresAt)
  }
}

/**
 * DELETE /restaurants/me/members/:id — exclui o funcionário (E.2): perde o acesso na hora, sai da lista,
 * libera a vaga e o e-mail (pode ser convidado de novo). Os lançamentos dele continuam com o nome no histórico.
 */
export class DeleteMemberUseCase {
  constructor (
    private readonly members: MemberRepository = new MemberRepository(),
    private readonly auth: AuthRepository = new AuthRepository(),
  ) {}

  async execute (ctx: RequestContext, id: string): Promise<void> {
    const owner = await requireOwner(ctx, this.auth)
    const member = await this.members.find(id, ctx)
    if (!member) throw new NotFoundError(Resource.Member, id)
    const memberId = String(member._id)
    await this.members.remove(member, ctx)
    await new MemberInviteRepository(ctx.env).invalidateAllForUser(memberId)
    await revokeAllSessions(memberId, ctx, 'member_removed')
    await logAudit('member_removed', String(owner._id), ctx.env, owner.restaurantId, { memberId, email: member.email }).catch(() => null)
  }
}
