import { scryptSync, timingSafeEqual } from 'crypto'
import type { User, LoginResult, RefreshResult, AuthUser } from 'mintly-lib'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { AuthRepository } from '../auth-repository'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { RequestContext } from '../../../core/context/request-context'

const TENANT = 'mintly'

export class AuthUseCase {
  private readonly repo = new AuthRepository()

  async login (email: string, password: string, ctx: RequestContext): Promise<LoginResult> {
    const user = await this.repo.findByEmail(email, ctx)
    if (!user || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError('Credenciais inválidas')
    }

    const userId = String(user._id)
    // best-effort, não bloqueia o login se falhar
    await this.repo.updateLastAccess(userId, ctx).catch(() => null)

    const jwt = getJwtService(ctx.env)
    const tokens = await jwt.generate({
      tenantId: TENANT,
      subject: userId,
      claims: {
        name: user.person.name,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId,
      },
    })

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

  async logout (refreshToken: string, ctx: RequestContext): Promise<void> {
    const jwt = getJwtService(ctx.env)
    await jwt.revokeRefreshToken(refreshToken)
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
