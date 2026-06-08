import { randomBytes, scryptSync } from 'crypto'
import { AuthRepository } from '../auth-repository'
import { PasswordResetRepository } from '../password-reset-repository'
import { getEmailService } from '../../../infrastructure/email/email-service'
import { logAudit } from '../../audit/audit-service'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import {
  requestRecoverySchema,
  resetPasswordSchema,
  throwFieldError,
  type RequestRecoveryInput,
  type ResetPasswordInput,
} from '../password-recovery-schema'
import { authDbName } from '../auth-db'

export type { RequestRecoveryInput, ResetPasswordInput }

const RECOVERY_TOKEN_EXPIRY_HOURS = Number(process.env.RECOVERY_TOKEN_EXPIRY_HOURS ?? 1)

export class PasswordRecoveryUseCase {
  private authRepo (env = 'default') { return new AuthRepository(env) }
  private tokenRepo (env = 'default') { return new PasswordResetRepository(env) }

  async requestRecovery (input: RequestRecoveryInput, env = 'default'): Promise<void> {
    requestRecoverySchema.parse(input)

    const user = await this.authRepo(env).findByEmail(input.email)

    // Não revela se o e-mail existe
    if (!user || user.status === 'inactive') return

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_EXPIRY_HOURS * 3_600_000).toISOString()

    await this.tokenRepo(env).invalidateAllForUser(String(user._id))
    await this.tokenRepo(env).create({
      token,
      userId: String(user._id),
      expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
    })

    await getEmailService().sendPasswordRecovery(user.email, token)

    logAudit('password_recovery_requested', String(user._id), { email: user.email }, undefined, env).catch(() => null)
  }

  async resetPassword (input: ResetPasswordInput, env = 'default'): Promise<void> {
    resetPasswordSchema.parse(input)

    if (input.newPassword !== input.confirmNewPassword) {
      throwFieldError('confirmNewPassword', 'As senhas não conferem.')
    }

    const record = await this.tokenRepo(env).findValid(input.token)
    if (!record) {
      throw new UnauthorizedError('Token inválido ou expirado.')
    }

    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(input.newPassword, salt, 64).toString('hex')
    const passwordHash = `${salt}:${hash}`

    await this.authRepo(env).updatePassword(record.userId, passwordHash)
    await this.tokenRepo(env).markUsed(input.token)
    await this.revokeAllSessions(record.userId)

    logAudit('password_reset', record.userId, {}, undefined, env).catch(() => null)
  }

  private async revokeAllSessions (userId: string): Promise<void> {
    try {
      const db = MongoDBConnection.getInstance().getDatabase(
        process.env.MONGODB_DB ?? 'mintly',
      )
      await db.collection('valkyrie_refresh_tokens').updateMany(
        { subject: userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revocationReason: 'password_reset' } },
      )
    } catch {
      // Best-effort — access tokens expiram naturalmente em 15min
    }
  }
}
