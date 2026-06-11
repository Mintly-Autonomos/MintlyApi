import { scryptSync, timingSafeEqual } from 'crypto'
import type { User, LoginResult, RefreshResult, AuthUser } from 'mintly-lib'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { AuthRepository, UserRecord } from '../auth-repository'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ForbiddenError } from '../../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../../core/errors/auth/too-many-requests-error'
import { RequestContext } from '../../../core/context/request-context'
import { logAudit } from '../../audit/audit-service'
import type { MintlyClaims } from '../jwt-claims'

const TENANT = 'mintly'
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5)
const BLOCK_DURATION_MINUTES = Number(process.env.BLOCK_DURATION_MINUTES ?? 15)

export interface LoginMeta {
  ip?: string
  userAgent?: string
}

export class AuthUseCase {
  private readonly repo = new AuthRepository()

  async login (email: string, password: string, ctx: RequestContext, meta: LoginMeta = {}): Promise<LoginResult> {
    const user = await this.repo.findByEmail(email, ctx)
    if (!user) {
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

    await logAudit('login', userId, { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, user.restaurantId, ctx.env).catch(() => null)

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
    return {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    }
  }

  async logout (refreshToken: string, ctx: RequestContext, userId?: string, restaurantId?: string): Promise<void> {
    const jwt = getJwtService(ctx.env)
    await jwt.revokeRefreshToken(refreshToken)
    if (userId) {
      await logAudit('logout', userId, {}, restaurantId, ctx.env).catch(() => null)
    }
  }

  private async handleFailedAttempt (user: UserRecord, ctx: RequestContext, meta: LoginMeta): Promise<void> {
    const userId = String(user._id)
    const attempts = await this.repo.incrementLoginAttempts(userId, ctx)
    await logAudit('login_failed', userId, { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, attempt: attempts }, user.restaurantId, ctx.env).catch(() => null)

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MINUTES * 60_000)
      await this.repo.setTemporaryBlock(userId, blockedUntil, ctx)
      await logAudit('account_temporarily_blocked', userId, { blockedUntil: blockedUntil.toISOString(), attempts }, user.restaurantId, ctx.env).catch(() => null)
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
