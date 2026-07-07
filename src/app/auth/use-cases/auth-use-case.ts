import { scryptSync, timingSafeEqual, randomBytes } from 'crypto'
import type { User, LoginResult, RefreshResult, AuthUser } from 'mintly-lib'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { AuthRepository, UserRecord } from '../auth-repository'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ForbiddenError } from '../../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../../core/errors/auth/too-many-requests-error'
import { RequestContext } from '../../../core/context/request-context'
import { logAudit } from '../../audit/audit-service'
import { normalizeEmail } from '../normalize-email'
import type { MintlyClaims } from '../jwt-claims'

const TENANT = 'mintly'
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5)
const BLOCK_DURATION_MINUTES = Number(process.env.BLOCK_DURATION_MINUTES ?? 15)

// Hash dummy (válido) usado para equalizar o tempo do login quando o e-mail não
// existe: rodamos o mesmo scrypt do caminho de senha errada, evitando o oráculo
// de timing que revelaria quais e-mails estão cadastrados.
const DUMMY_PASSWORD_HASH = ((): string => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync('timing-equalizer', salt, 64).toString('hex')}`
})()

export interface LoginMeta {
  ip?: string
  userAgent?: string
}

export class AuthUseCase {
  private readonly repo = new AuthRepository()

  async login (email: string, password: string, ctx: RequestContext, meta: LoginMeta = {}): Promise<LoginResult> {
    const user = await this.repo.findByEmail(normalizeEmail(email), ctx)
    if (!user) {
      // Roda o scrypt mesmo sem usuário: o 401 de e-mail inexistente custa ~o
      // mesmo que o de senha errada (anti-enumeração por timing).
      this.verifyPassword(password, DUMMY_PASSWORD_HASH)
      throw new UnauthorizedError('Credenciais inválidas')
    }

    if (user.blockedUntil && new Date(user.blockedUntil) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.blockedUntil).getTime() - Date.now()) / 60_000)
      throw new TooManyRequestsError(`Conta temporariamente bloqueada. Tente novamente em ${minutesLeft} minuto(s).`)
    }

    if (!this.verifyPassword(password, user.passwordHash)) {
      await this.handleFailedAttempt(user, ctx, meta)
      throw new UnauthorizedError('Credenciais inválidas')
    }

    // Status só é revelado a quem provou ter a credencial — antes disso a resposta
    // é o 401 genérico, para não permitir enumerar contas inativas/bloqueadas (RN9).
    if (user.status === 'inactive') {
      throw new ForbiddenError('Conta inativa. Entre em contato com o suporte.')
    }
    if (user.status === 'blocked') {
      throw new ForbiddenError('Conta bloqueada. Entre em contato com o suporte.')
    }

    const userId = String(user._id)
    await this.repo.resetLoginAttempts(userId, ctx)
    await this.repo.updateLastAccess(userId, ctx).catch(() => null)

    const jwt = getJwtService(ctx.env)
    const claims: MintlyClaims = {
      name: user.person.name,
      email: user.email,
      restaurantId: user.restaurantId,
      role: user.role,
      status: user.status,
    }
    const tokens = await jwt.generate({ tenantId: TENANT, subject: userId, claims })

    await logAudit('login', userId, ctx.env, user.restaurantId, { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }).catch(() => null)

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this.toPublic(user),
    }
  }

  async refresh (refreshToken: string, ctx: RequestContext): Promise<RefreshResult> {
    const jwt = getJwtService(ctx.env)
    const result = await jwt.refresh(refreshToken)
    if (!result.succeeded || !result.tokens) {
      throw new UnauthorizedError(result.failureReason ?? 'Token inválido')
    }

    // Reconsulta o usuário: quem foi desativado/bloqueado/removido DEPOIS do login
    // não pode renovar o acesso — senão manteria tokens válidos por todo o refresh
    // lifetime (7 dias). O `subject` vem do access token recém-emitido.
    const validation = await jwt.validate(result.tokens.accessToken)
    const userId = validation.succeeded ? validation.subject : undefined
    const user = typeof userId === 'string' ? await this.repo.findById(userId, ctx) : null
    if (!user || user.status !== 'active') {
      if (result.tokens.refreshToken != null) {
        await jwt.revokeRefreshToken(result.tokens.refreshToken).catch(() => null)
      }
      throw new UnauthorizedError('Sessão inválida. Faça login novamente.')
    }

    return {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    }
  }

  async logout (refreshToken: string, ctx: RequestContext, userId?: string, restaurantId?: string): Promise<void> {
    const jwt = getJwtService(ctx.env)
    await jwt.revokeRefreshToken(refreshToken)
    if (userId) {
      await logAudit('logout', userId, ctx.env, restaurantId, {}).catch(() => null)
    }
  }

  private async handleFailedAttempt (user: UserRecord, ctx: RequestContext, meta: LoginMeta): Promise<void> {
    const userId = String(user._id)
    const attempts = await this.repo.incrementLoginAttempts(userId, ctx)
    await logAudit('login_failed', userId, ctx.env, user.restaurantId, { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, attempt: attempts }).catch(() => null)

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MINUTES * 60_000)
      await this.repo.setTemporaryBlock(userId, blockedUntil, ctx)
      await logAudit('account_temporarily_blocked', userId, ctx.env, user.restaurantId, { blockedUntil: blockedUntil.toISOString(), attempts }).catch(() => null)
    }
  }

  /** Remove o passwordHash antes de devolver o usuário ao cliente. */
  private toPublic (user: User): AuthUser {
    const copy: Partial<User> = { ...user }
    delete copy.passwordHash
    return copy as AuthUser
  }

  private verifyPassword (password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const incoming = scryptSync(password, salt, 64)
    return timingSafeEqual(Buffer.from(hash, 'hex'), incoming)
  }
}
