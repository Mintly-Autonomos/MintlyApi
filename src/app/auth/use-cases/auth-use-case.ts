import { scryptSync, timingSafeEqual } from 'crypto'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { AuthRepository } from '../auth-repository'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ForbiddenError } from '../../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../../core/errors/auth/too-many-requests-error'
import { logAudit } from '../../audit/audit-service'
import { User } from '../../user/user'
import type { MintlyClaims } from '../jwt-claims'

const TENANT = 'mintly'
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5)
const BLOCK_DURATION_MINUTES = Number(process.env.BLOCK_DURATION_MINUTES ?? 15)

export type AuthUser = Pick<User, 'name' | 'email'>

export interface LoginResult {
  accessToken: string
  refreshToken: string | null
  user: AuthUser
}

export interface RefreshResult {
  accessToken: string
  refreshToken: string | null
}

export interface LoginContext {
  ip?: string
  userAgent?: string
  env?: string
}

export class AuthUseCase {
  private repo (env = 'default') { return new AuthRepository(env) }

  async login (email: string, password: string, ctx: LoginContext = {}): Promise<LoginResult> {
    const env = ctx.env ?? 'default'
    const person = await this.repo(env).findByEmail(email)

    if (!person) {
      throw new UnauthorizedError('Credenciais inválidas')
    }

    if (person.status === 'inactive') {
      throw new ForbiddenError('Conta inativa. Entre em contato com o suporte.')
    }
    if (person.status === 'blocked') {
      throw new ForbiddenError('Conta bloqueada. Entre em contato com o suporte.')
    }

    if (person.blockedUntil && new Date(person.blockedUntil) > new Date()) {
      const minutesLeft = Math.ceil((new Date(person.blockedUntil).getTime() - Date.now()) / 60_000)
      throw new TooManyRequestsError(
        `Conta temporariamente bloqueada. Tente novamente em ${minutesLeft} minuto(s).`,
      )
    }

    if (!this.verifyPassword(password, person.passwordHash)) {
      await this.handleFailedAttempt(person, ctx)
      throw new UnauthorizedError('Credenciais inválidas')
    }

    await this.repo(env).resetLoginAttempts(String(person._id))
    await this.repo(env).updateLastAccess(String(person._id)).catch(() => null)

    const jwt = getJwtService()
    const claims: MintlyClaims = {
      name: person.name,
      email: person.email,
      restaurantId: person.restaurantId ?? '',
      role: person.role,
      status: person.status,
      ...(person.cpf ? { cpf: person.cpf } : {}),
    }
    const tokens = await jwt.generate({ tenantId: TENANT, subject: String(person._id), claims })

    logAudit('login', String(person._id), { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null }, undefined, env).catch(() => null)

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { name: person.name, email: person.email },
    }
  }

  async refresh (refreshToken: string): Promise<RefreshResult> {
    const jwt = getJwtService()
    const result = await jwt.refresh(refreshToken)
    if (!result.succeeded || !result.tokens) {
      throw new UnauthorizedError(result.failureReason ?? 'Token inválido')
    }
    return {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    }
  }

  async logout (refreshToken: string, userId?: string, env = 'default'): Promise<void> {
    const jwt = getJwtService()
    await jwt.revokeRefreshToken(refreshToken)
    if (userId) {
      logAudit('logout', userId, {}, undefined, env).catch(() => null)
    }
  }

  private async handleFailedAttempt (person: User, ctx: LoginContext): Promise<void> {
    const userId = String(person._id)
    const env = ctx.env ?? 'default'
    const attempts = await this.repo(env).incrementLoginAttempts(userId)

    logAudit('login_failed', userId, { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, attempt: attempts }, undefined, env).catch(() => null)

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MINUTES * 60_000)
      await this.repo(env).setTemporaryBlock(userId, blockedUntil)
      logAudit('account_temporarily_blocked', userId, { blockedUntil: blockedUntil.toISOString(), attempts }, undefined, env).catch(() => null)
    }
  }

  private verifyPassword (password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const incoming = scryptSync(password, salt, 64)
    return timingSafeEqual(Buffer.from(hash, 'hex'), incoming)
  }
}
