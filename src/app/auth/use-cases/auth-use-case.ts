import { scryptSync, timingSafeEqual } from 'crypto'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { AuthRepository } from '../auth-repository'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { User } from '../../user/user'

const TENANT = 'mintly'

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

export class AuthUseCase {
  private readonly repo = new AuthRepository()

  async login (email: string, password: string): Promise<LoginResult> {
    const person = await this.repo.findByEmail(email)
    if (!person || !this.verifyPassword(password, person.passwordHash)) {
      throw new UnauthorizedError('Credenciais inválidas')
    }

    // Update last access (best effort, non-transactional)
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

  async logout (refreshToken: string): Promise<void> {
    const jwt = getJwtService()
    await jwt.revokeRefreshToken(refreshToken)
  }

  private verifyPassword (password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const incoming = scryptSync(password, salt, 64)
    return timingSafeEqual(Buffer.from(hash, 'hex'), incoming)
  }
}
