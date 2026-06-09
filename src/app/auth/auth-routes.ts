import { FastifyInstance } from 'fastify'
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
  fastify.post('/logout', logoutController)
  fastify.post('/recuperar-senha', requestRecoveryController)
  fastify.post('/redefinir-senha', resetPasswordController)
}
