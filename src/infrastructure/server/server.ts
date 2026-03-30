import Fastify from 'fastify'
import cors from '@fastify/cors'
import * as dotenv from 'dotenv'
import { mongoConnection } from '../db/mongodb'
import { personRoutes } from '../../app/person/person-routes'
import { BaseError } from '../../core/errors/core/base-error'
import { AuroraValidationError } from 'mintly-lib'

dotenv.config()

const server = Fastify()

async function start () {
  try {
    // 1. Conectar ao MongoDB PRIMEIRO
    await mongoConnection.connect()
    mongoConnection.setupGracefulShutdown()
    console.log('MongoDB conectado')

    // 2. Registrar plugins
    await server.register(cors, { origin: true })

    // 3. Middleware para configurar CSP
    server.addHook('onSend', async (request, reply, payload) => {
      reply.header('Content-Security-Policy', `default-src 'self'; connect-src 'self' ${process.env.API_URL || 'http://localhost:3000'};`)
      return payload
    })

    // 4. Error handler global
    server.setErrorHandler((error, request, reply) => {
      // Erros de negócio/aplicação (NotFoundError, etc)
      if (error instanceof BaseError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.apiMessage,
        })
      }

      // Erros de validação do Aurora
      if (error instanceof AuroraValidationError) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: error.details,
        })
      }

      // Erros não tratados (500)
      console.error('Erro não tratado:', error)
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      })
    })

    // 5. Registrar rotas
    await server.register(personRoutes, { prefix: '/people' })

    // 6. Iniciar servidor
    await server.listen({
      host: '0.0.0.0',
      port: process.env.PORT ?? 3000,
    } as any)

    console.log(`Servidor rodando na porta ${process.env.PORT ?? 3000}`)
  } catch (error) {
    console.error('Erro ao iniciar servidor:', error)
    process.exit(1)
  }
}

start()
