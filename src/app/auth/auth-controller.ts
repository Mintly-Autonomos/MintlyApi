import { FastifyRequest, FastifyReply } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { AuthUseCase } from './use-cases/auth-use-case'
import { RegisterUseCase } from './use-cases/register-use-case'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { buildRequestContext } from '../../core/context/build-request-context'

const authUseCase = new AuthUseCase()
const registerUseCase = new RegisterUseCase()

export async function signupController (request: FastifyRequest, reply: FastifyReply) {
  const ctx = buildRequestContext(request.headers)
  const result = await registerUseCase.execute(request.body, ctx)
  return new ResponseBuilder().response(reply).status(StatusCodes.CREATED).payload(result).build()
}

export async function loginController (
  request: FastifyRequest<{ Body: { email: string; password: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request.headers)
  const { email, password } = request.body
  const result = await authUseCase.login(email, password, ctx)
  return new ResponseBuilder().response(reply).payload(result).build()
}

export async function refreshController (
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request.headers)
  const result = await authUseCase.refresh(request.body.refreshToken, ctx)
  return new ResponseBuilder().response(reply).payload(result).build()
}

export async function logoutController (
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply,
) {
  const ctx = buildRequestContext(request.headers)
  await authUseCase.logout(request.body.refreshToken, ctx)
  return reply.status(StatusCodes.NO_CONTENT).send()
}
