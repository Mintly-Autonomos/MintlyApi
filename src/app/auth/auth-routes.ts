import { FastifyInstance } from 'fastify'
import { verifyJwt } from '../../core/hooks/verify-jwt'
import {
  loginController,
  signupController,
  refreshController,
  logoutController,
  requestRecoveryController,
  resetPasswordController,
} from './auth-controller'

const str = { type: 'string' as const }

// Schemas Fastify de body: guarda a FORMA/tipos (campos obrigatórios existem e
// são do tipo certo) + alimenta o Swagger. A validação PROFUNDA (regras de
// senha, e-mail, cross-field) segue no Sapphire dentro dos use cases; por isso
// os tipos aqui são propositalmente frouxos (não duplicam as regras).
const bodySchema = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object',
  required,
  properties,
})

export async function authRoutes (fastify: FastifyInstance) {
  fastify.post('/signup', {
    schema: {
      tags: ['auth'],
      summary: 'Cadastro (onboarding do restaurante)',
      body: bodySchema(
        ['person', 'email', 'password', 'restaurantName', 'termsAccepted'],
        { person: { type: 'object' }, email: str, password: str, restaurantName: str, termsAccepted: { type: 'boolean' } },
      ),
    },
  }, signupController)

  fastify.post('/login', {
    schema: {
      tags: ['auth'],
      summary: 'Login',
      body: bodySchema(['email', 'password'], { email: str, password: str }),
    },
  }, loginController)

  fastify.post('/refresh', {
    schema: {
      tags: ['auth'],
      summary: 'Renova o access token',
      body: bodySchema(['refreshToken'], { refreshToken: str }),
    },
  }, refreshController)

  // Logout exige Bearer válido: é de onde saem userId/restaurantId da auditoria (RN19).
  fastify.post<{ Body: { refreshToken: string } }>('/logout', {
    preHandler: verifyJwt,
    schema: {
      tags: ['auth'],
      summary: 'Logout (revoga o refresh token)',
      body: bodySchema(['refreshToken'], { refreshToken: str }),
    },
  }, logoutController)

  fastify.post('/forgot-password', {
    schema: {
      tags: ['auth'],
      summary: 'Solicita recuperação de senha',
      body: bodySchema(['email'], { email: str }),
    },
  }, requestRecoveryController)

  fastify.post('/reset-password', {
    schema: {
      tags: ['auth'],
      summary: 'Redefine a senha via token',
      body: bodySchema(['token', 'newPassword'], { token: str, newPassword: str, confirmNewPassword: str }),
    },
  }, resetPasswordController)
}
