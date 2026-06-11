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

export async function authRoutes (fastify: FastifyInstance) {
  fastify.post('/signup', signupController)
  fastify.post('/login', loginController)
  fastify.post('/refresh', refreshController)
  // Logout exige Bearer válido: é de onde saem userId/restaurantId da auditoria (RN19).
  fastify.post<{ Body: { refreshToken: string } }>('/logout', { preHandler: verifyJwt }, logoutController)
  fastify.post('/forgot-password', requestRecoveryController)
  fastify.post('/reset-password', resetPasswordController)
}
