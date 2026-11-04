import {
  accountUpdateSchema,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
} from 'mintly-lib'
import type { AccountMessage, MyAccount } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { requireTenant } from '../../../core/context/require-tenant'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { logAudit } from '../../audit/audit-service'
import { AuthRepository, UserRecord } from '../../auth/auth-repository'
import { normalizeEmail } from '../../auth/normalize-email'
import { confirmCurrentPassword } from '../../auth/password-confirmation'
import { hashPassword, verifyPassword } from '../../auth/password-hash'
import { PasswordResetRepository } from '../../auth/password-reset-repository'
import { revokeAllSessions } from '../../auth/session-revocation'
import { UserRepository } from '../user-repository'

/** Usuário ATIVO do token. Inativado/removido depois do login não mexe mais na conta. */
async function activeUser (ctx: RequestContext, auth: AuthRepository): Promise<UserRecord> {
  const { userId } = requireTenant(ctx)
  const user = await auth.findById(userId, ctx).catch(() => null)
  if (!user || user.status !== 'active') throw new UnauthorizedError('Sessão inválida. Faça login novamente.')
  return user
}

/** GET /users/me */
export class GetMyAccountQuery {
  constructor (
    private readonly auth: AuthRepository = new AuthRepository(),
    private readonly users: UserRepository = new UserRepository(),
  ) {}

  async execute (ctx: RequestContext): Promise<MyAccount> {
    return this.users.getAccount(await activeUser(ctx, this.auth), ctx)
  }
}

/** PATCH /users/me — nome e telefone. E-mail e senha têm rota própria (pedem a senha atual). */
export class UpdateMyAccountUseCase {
  constructor (
    private readonly auth: AuthRepository = new AuthRepository(),
    private readonly users: UserRepository = new UserRepository(),
  ) {}

  async execute (ctx: RequestContext, body: unknown): Promise<MyAccount> {
    const changes = accountUpdateSchema.parse(body ?? {}) as { name?: string; phone?: string }
    const user = await activeUser(ctx, this.auth)

    const clean: { name?: string; phone?: string } = {}
    if (changes.name !== undefined) {
      if (changes.name.trim().length < 2) throw new ValidationError('O nome deve ter pelo menos 2 caracteres.')
      clean.name = changes.name.trim()
    }
    if (changes.phone !== undefined) {
      if (changes.phone.trim().length < 8) throw new ValidationError('Informe um telefone válido.')
      clean.phone = changes.phone.trim()
    }

    if (Object.keys(clean).length > 0) {
      await this.users.updateProfile(user, clean, ctx)
      await logAudit('account_updated', String(user._id), ctx.env, user.restaurantId, { fields: Object.keys(clean) }).catch(() => null)
    }
    return this.users.getAccount(await activeUser(ctx, this.auth), ctx)
  }
}

/** PATCH /users/me/email — o novo e-mail só vale com a senha atual. */
export class ChangeMyEmailUseCase {
  constructor (
    private readonly auth: AuthRepository = new AuthRepository(),
    private readonly users: UserRepository = new UserRepository(),
    private readonly recovery: (env: string) => PasswordResetRepository = (env) => new PasswordResetRepository(env),
  ) {}

  async execute (ctx: RequestContext, body: unknown): Promise<MyAccount> {
    // Espaços nas pontas (copiar e colar) não podem derrubar um e-mail certo.
    const raw = (body ?? {}) as Record<string, unknown>
    const input = changeEmailRequestSchema.parse({
      ...raw,
      email: typeof raw.email === 'string' ? raw.email.trim() : raw.email,
    }) as { email: string; currentPassword: string }
    const user = await activeUser(ctx, this.auth)
    await confirmCurrentPassword(user, input.currentPassword, ctx, this.auth)

    const email = normalizeEmail(input.email)
    if (email === user.email) throw new ValidationError('Esse já é o e-mail da sua conta.')
    if (await this.users.emailInUse(email, ctx)) throw new ConflictError('Este e-mail já está cadastrado.')

    try {
      await this.users.updateEmail(String(user._id), email, ctx)
    } catch (err) {
      // Duas trocas ao mesmo tempo para o mesmo e-mail: o índice único decide.
      if ((err as { code?: number })?.code === 11000) throw new ConflictError('Este e-mail já está cadastrado.')
      throw err
    }

    // Links de recuperação pedidos para o e-mail antigo deixam de valer.
    await this.recovery(ctx.env).invalidateAllForUser(String(user._id)).catch(() => null)
    await logAudit('email_changed', String(user._id), ctx.env, user.restaurantId, { from: user.email, to: email }).catch(() => null)

    return this.users.getAccount({ ...user, email }, ctx)
  }
}

/**
 * POST /users/me/password — troca de senha logado, com a antiga. Encerra TODAS as sessões do usuário (a
 * pessoa entra de novo com a senha nova): quem tinha a senha antiga, ou um token, perde o acesso.
 */
export class ChangeMyPasswordUseCase {
  constructor (private readonly auth: AuthRepository = new AuthRepository()) {}

  async execute (ctx: RequestContext, body: unknown): Promise<AccountMessage> {
    const input = changePasswordRequestSchema.parse(body ?? {}) as { currentPassword: string; newPassword: string }
    const user = await activeUser(ctx, this.auth)
    await confirmCurrentPassword(user, input.currentPassword, ctx, this.auth)

    if (verifyPassword(input.newPassword, user.passwordHash)) {
      throw new ValidationError('A senha nova deve ser diferente da atual.')
    }

    await this.auth.updatePassword(String(user._id), hashPassword(input.newPassword), ctx)
    await revokeAllSessions(String(user._id), ctx, 'password_changed')
    await logAudit('password_changed', String(user._id), ctx.env, user.restaurantId, {}).catch(() => null)

    return { message: 'Senha alterada. Entre novamente com a senha nova.' }
  }
}
