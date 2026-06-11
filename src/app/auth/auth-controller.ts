import { FastifyRequest, FastifyReply } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { AuthUseCase } from './use-cases/auth-use-case'
import { RegisterUseCase } from './use-cases/register-use-case'
import { PasswordRecoveryUseCase } from './use-cases/password-recovery-use-case'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { buildRequestContext } from '../../core/context/build-request-context'
import { requireTenant } from '../../core/context/require-tenant'

const authUseCase = new AuthUseCase()
const registerUseCase = new RegisterUseCase()
const recoveryUseCase = new PasswordRecoveryUseCase()

export async function signupController (request: FastifyRequest, reply: FastifyReply) {
  const ctx = buildRequestContext(request)
  const result = await registerUseCase.execute(request.body, ctx)
  return new ResponseBuilder().response(reply).status(StatusCodes.CREATED).payload(result).build()
}

export async function loginController (
  request: FastifyRequest<{ Body: { email: string; password: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request)
  const { email, password } = request.body
  const result = await authUseCase.login(email, password, ctx, {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  })
  return new ResponseBuilder().response(reply).payload(result).build()
}

export async function refreshController (
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request)
  const result = await authUseCase.refresh(request.body.refreshToken, ctx)
  return new ResponseBuilder().response(reply).payload(result).build()
}

export async function logoutController (
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request)
  const { userId, restaurantId } = requireTenant(ctx)
  await authUseCase.logout(request.body.refreshToken, ctx, userId, restaurantId)
  return reply.status(StatusCodes.NO_CONTENT).send()
}

export async function requestRecoveryController (
  request: FastifyRequest<{ Body: { email: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request)
  await recoveryUseCase.requestRecovery(request.body, ctx)
  return new ResponseBuilder()
    .response(reply)
    .status(StatusCodes.ACCEPTED)
    .payload({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.' })
    .build()
}

export async function resetPasswordController (
  request: FastifyRequest<{ Body: { token: string; newPassword: string; confirmNewPassword: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request)
  await recoveryUseCase.resetPassword(request.body, ctx)
  return new ResponseBuilder().response(reply).payload({ message: 'Senha redefinida com sucesso.' }).build()
}
