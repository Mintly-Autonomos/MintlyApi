import { createHash, randomBytes, scryptSync } from 'crypto'
import { AuthRepository } from '../auth-repository'
import { PasswordResetRepository } from '../password-reset-repository'
import { getEmailService } from '../../../infrastructure/email/email-service'
import { logAudit } from '../../audit/audit-service'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { RequestContext } from '../../../core/context/request-context'
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

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export class PasswordRecoveryUseCase {
  private readonly authRepo = new AuthRepository()

  async requestRecovery (input: RequestRecoveryInput, ctx: RequestContext): Promise<void> {
    requestRecoverySchema.parse(input)

    const user = await this.authRepo.findByEmail(input.email, ctx)

    // Não revela se o e-mail existe
    if (!user || user.status === 'inactive') return

    // O token em claro só viaja no e-mail; no banco fica apenas o sha256,
    // para que um vazamento de leitura do banco não permita tomar contas.
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_EXPIRY_HOURS * 3_600_000)

    const tokenRepo = new PasswordResetRepository(ctx.env)
    await tokenRepo.invalidateAllForUser(String(user._id))
    await tokenRepo.create({
      token: sha256(token),
      userId: String(user._id),
      expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
    })

    // Fire-and-forget: falha no provedor não pode virar 500 (nem abrir canal de
    // timing que diferencie e-mails cadastrados de não cadastrados).
    getEmailService().sendPasswordRecovery(user.email, token)
      .catch(err => console.error('[RECOVERY] Falha ao enviar e-mail:', err))

    await logAudit('password_recovery_requested', String(user._id), { email: user.email }, user.restaurantId, ctx.env).catch(() => null)
  }

  async resetPassword (input: ResetPasswordInput, ctx: RequestContext): Promise<void> {
    resetPasswordSchema.parse(input)

    if (input.newPassword !== input.confirmNewPassword) {
      throwFieldError('confirmNewPassword', 'As senhas não conferem.')
    }

    // Claim atômico: valida e queima o token numa única operação. Se algo falhar
    // depois daqui, o token já era — o usuário solicita um novo link (fail-closed).
    const tokenRepo = new PasswordResetRepository(ctx.env)
    const record = await tokenRepo.claim(sha256(input.token))
    if (!record) {
      throw new UnauthorizedError('Token inválido ou expirado.')
    }

    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(input.newPassword, salt, 64).toString('hex')
    const passwordHash = `${salt}:${hash}`

    await this.authRepo.updatePassword(record.userId, passwordHash, ctx)
    await this.revokeAllSessions(record.userId, ctx)

    const user = await this.authRepo.findById(record.userId, ctx).catch(() => null)
    await logAudit('password_reset', record.userId, {}, user?.restaurantId, ctx.env).catch(() => null)
  }

  private async revokeAllSessions (userId: string, ctx: RequestContext): Promise<void> {
    try {
      const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
      await db.collection('valkyrie_refresh_tokens').updateMany(
        { subject: userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revocationReason: 'password_reset' } },
      )
    } catch {
      // Best-effort — access tokens expiram naturalmente em 15min
    }
  }
}
