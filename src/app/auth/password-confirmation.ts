import { RequestContext } from '../../core/context/request-context'
import { ForbiddenError } from '../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../core/errors/auth/too-many-requests-error'
import { logAudit } from '../audit/audit-service'
import { AuthRepository, UserRecord } from './auth-repository'
import { BLOCK_DURATION_MINUTES, MAX_LOGIN_ATTEMPTS } from './login-lockout-config'
import { verifyPassword } from './password-hash'

/**
 * Confirma a senha atual de quem já está logado (trocar e-mail ou senha, pedir exclusão). Usa o MESMO
 * contador de tentativas do login: errar demais bloqueia a conta por alguns minutos, então um token
 * roubado não serve para adivinhar a senha. Senha errada é 403 (não 401: o token está certo, e o 401
 * faria o app achar que a sessão acabou).
 */
export async function confirmCurrentPassword (
  user: UserRecord,
  password: string,
  ctx: RequestContext,
  repo: AuthRepository = new AuthRepository(),
): Promise<void> {
  const userId = String(user._id)

  if (user.blockedUntil && new Date(user.blockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.blockedUntil).getTime() - Date.now()) / 60_000)
    throw new TooManyRequestsError(`Conta temporariamente bloqueada. Tente novamente em ${minutesLeft} minuto(s).`)
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MINUTES * 60_000)
    const { attempts, blocked } = await repo.registerFailedAttempt(userId, MAX_LOGIN_ATTEMPTS, blockedUntil, ctx)
    await logAudit('password_confirmation_failed', userId, ctx.env, user.restaurantId, { attempt: attempts }).catch(() => null)
    if (blocked) {
      await logAudit('account_temporarily_blocked', userId, ctx.env, user.restaurantId, { blockedUntil: blockedUntil.toISOString(), attempts }).catch(() => null)
      throw new TooManyRequestsError(`Conta temporariamente bloqueada. Tente novamente em ${BLOCK_DURATION_MINUTES} minuto(s).`)
    }
    throw new ForbiddenError('Senha incorreta.')
  }

  await repo.resetLoginAttempts(userId, ctx)
}
