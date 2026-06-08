import { FastifyRequest, FastifyReply } from 'fastify'
import { AuthUseCase } from './use-cases/auth-use-case'
import { RegisterUseCase } from './use-cases/register-use-case'
import { PasswordRecoveryUseCase } from './use-cases/password-recovery-use-case'

const authUseCase = new AuthUseCase()
const registerUseCase = new RegisterUseCase()
const recoveryUseCase = new PasswordRecoveryUseCase()

export async function loginController (
  request: FastifyRequest<{ Body: { email: string; password: string } }>,
  reply: FastifyReply,
) {
  const { email, password } = request.body
  const result = await authUseCase.login(email, password, {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  })
  return reply.send(result)
}

export async function registerController (
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await registerUseCase.execute(request.body)
  return reply.status(201).send(result)
}

export async function refreshController (
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply,
) {
  const { refreshToken } = request.body
  const result = await authUseCase.refresh(refreshToken)
  return reply.send(result)
}

export async function logoutController (
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply,
) {
  const { refreshToken } = request.body
  const userId = (request as any).jwtClaims?.subject as string | undefined
  await authUseCase.logout(refreshToken, userId)
  return reply.status(204).send()
}

export async function requestRecoveryController (
  request: FastifyRequest<{ Body: { email: string } }>,
  reply: FastifyReply,
) {
  await recoveryUseCase.requestRecovery(request.body)
  // Sempre retorna 202 — não revela se o e-mail existe
  return reply.status(202).send({
    message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.',
  })
}

export async function resetPasswordController (
  request: FastifyRequest<{ Body: { token: string; novaSenha: string; confirmarNovaSenha: string } }>,
  reply: FastifyReply,
) {
  await recoveryUseCase.resetPassword(request.body)
  return reply.send({ message: 'Senha redefinida com sucesso.' })
}
