import { scryptSync, timingSafeEqual } from 'crypto'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { AuthRepository } from '../auth-repository'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ForbiddenError } from '../../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../../core/errors/auth/too-many-requests-error'
import { logAudit } from '../../audit/audit-service'
import { User } from '../../user/user'

const TENANT = 'mintly'
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5)
const BLOCK_DURATION_MINUTES = Number(process.env.BLOCK_DURATION_MINUTES ?? 15)

export type AuthUser = Pick<User, 'nome' | 'email'>

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
}

export class AuthUseCase {
  private readonly repo = new AuthRepository()

  async login (email: string, password: string, ctx: LoginContext = {}): Promise<LoginResult> {
    const person = await this.repo.findByEmail(email)

    // Resposta genérica — não revela se email existe ou senha está errada
    if (!person) {
      throw new UnauthorizedError('Credenciais inválidas')
    }

    // Conta inativa ou permanentemente bloqueada
    if (person.status === 'inativo') {
      throw new ForbiddenError('Conta inativa. Entre em contato com o suporte.')
    }
    if (person.status === 'bloqueado') {
      throw new ForbiddenError('Conta bloqueada. Entre em contato com o suporte.')
    }

    // Bloqueio temporário por tentativas excessivas
    if (person.bloqueadoAte && new Date(person.bloqueadoAte) > new Date()) {
      const minutosRestantes = Math.ceil(
        (new Date(person.bloqueadoAte).getTime() - Date.now()) / 60_000,
      )
      throw new TooManyRequestsError(
        `Conta temporariamente bloqueada. Tente novamente em ${minutosRestantes} minuto(s).`,
      )
    }

    if (!this.verifyPassword(password, person.passwordHash)) {
      await this.handleFailedAttempt(person, ctx)
      throw new UnauthorizedError('Credenciais inválidas')
    }

    // Login bem-sucedido — reset tentativas + registra acesso
    await this.repo.resetLoginAttempts(String(person._id))
    await this.repo.updateLastAccess(String(person._id)).catch(() => null)

    const jwt = getJwtService()
    const tokens = await jwt.generate({
      tenantId: TENANT,
      subject: String(person._id),
      claims: {
        nome: person.nome,
        email: person.email,
        ...(person.cpf ? { cpf: person.cpf } : {}),
      },
    })

    logAudit('login', String(person._id), {
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    }).catch(() => null)

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { nome: person.nome, email: person.email },
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

  async logout (refreshToken: string, userId?: string): Promise<void> {
    const jwt = getJwtService()
    await jwt.revokeRefreshToken(refreshToken)
    if (userId) {
      logAudit('logout', userId, {}).catch(() => null)
    }
  }

  private async handleFailedAttempt (person: User, ctx: LoginContext): Promise<void> {
    const userId = String(person._id)
    const attempts = await this.repo.incrementLoginAttempts(userId)

    logAudit('login_falhou', userId, {
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      tentativa: attempts,
    }).catch(() => null)

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MINUTES * 60_000)
      await this.repo.setTemporaryBlock(userId, blockedUntil)
      logAudit('conta_bloqueada_temporariamente', userId, {
        bloqueadoAte: blockedUntil.toISOString(),
        tentativas: attempts,
      }).catch(() => null)
    }
  }

  private verifyPassword (password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const incoming = scryptSync(password, salt, 64)
    return timingSafeEqual(Buffer.from(hash, 'hex'), incoming)
  }
}
