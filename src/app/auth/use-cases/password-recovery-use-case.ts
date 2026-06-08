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

export type { RequestRecoveryInput, ResetPasswordInput }

const RECOVERY_TOKEN_EXPIRY_HOURS = Number(process.env.RECOVERY_TOKEN_EXPIRY_HOURS ?? 1)

export class PasswordRecoveryUseCase {
  private readonly authRepo = new AuthRepository()
  private readonly tokenRepo = new PasswordResetRepository()

  async requestRecovery (input: RequestRecoveryInput): Promise<void> {
    requestRecoverySchema.parse(input)

    const user = await this.authRepo.findByEmail(input.email)

    // Não revela se o e-mail existe
    if (!user || user.status === 'inativo') return

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_EXPIRY_HOURS * 3_600_000).toISOString()

    await this.tokenRepo.invalidateAllForUser(String(user._id))
    await this.tokenRepo.create({
      token,
      userId: String(user._id),
      expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
    })

    await getEmailService().sendPasswordRecovery(user.email, token)

    logAudit('senha_recuperacao_solicitada', String(user._id), {
      email: user.email,
    }).catch(() => null)
  }

  async resetPassword (input: ResetPasswordInput): Promise<void> {
    resetPasswordSchema.parse(input)

    if (input.novaSenha !== input.confirmarNovaSenha) {
      throwFieldError('confirmarNovaSenha', 'As senhas não conferem.')
    }

    const record = await this.tokenRepo.findValid(input.token)
    if (!record) {
      throw new UnauthorizedError('Token inválido ou expirado.')
    }

    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(input.novaSenha, salt, 64).toString('hex')
    const passwordHash = `${salt}:${hash}`

    await this.authRepo.updatePassword(record.userId, passwordHash)
    await this.tokenRepo.markUsed(input.token)
    await this.revokeAllSessions(record.userId)

    logAudit('senha_redefinida', record.userId, {}).catch(() => null)
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
      // Best-effort — tokens expiram naturalmente se a revogação falhar
    }
  }
}
