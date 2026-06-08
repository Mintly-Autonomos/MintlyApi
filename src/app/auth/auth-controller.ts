import { FastifyRequest, FastifyReply } from 'fastify'
import { AuthUseCase } from './use-cases/auth-use-case'
import { RegisterUseCase } from './use-cases/register-use-case'

const authUseCase = new AuthUseCase()
const registerUseCase = new RegisterUseCase()

export async function loginController (
  request: FastifyRequest<{ Body: { email: string; password: string } }>,
  reply: FastifyReply,
) {
  const { email, password } = request.body
  const result = await authUseCase.login(email, password)
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
  await authUseCase.logout(refreshToken)
  return reply.status(204).send()
}
