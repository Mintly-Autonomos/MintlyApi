import { FastifyInstance } from 'fastify'
import {
  loginController,
  registerController,
  refreshController,
  logoutController,
  requestRecoveryController,
  resetPasswordController,
} from './auth-controller'

export async function authRoutes (fastify: FastifyInstance) {
  fastify.post('/login', loginController)
  fastify.post('/register', registerController)
  fastify.post('/refresh', refreshController)
  fastify.post('/logout', logoutController)
  fastify.post('/recuperar-senha', requestRecoveryController)
  fastify.post('/redefinir-senha', resetPasswordController)
}
