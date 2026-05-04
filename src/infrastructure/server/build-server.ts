import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { personRoutes } from '../../app/person/person-routes'
import { healthRoutes } from '../../app/health/health-routes'
import { BaseError } from '../../core/errors/core/base-error'

export async function buildServer (): Promise<FastifyInstance> {
  const server = Fastify()

  await server.register(cors, { origin: true })

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Mintly API',
        description: 'Mintly backend API documentation',
        version: '1.0.0',
      },
      servers: [
        {
          url: process.env.API_URL ?? 'http://localhost:3000',
          description: 'Current environment',
        },
      ],
      tags: [
        { name: 'people', description: 'People endpoints' },
        { name: 'system', description: 'System endpoints' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  })

  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', `default-src 'self'; connect-src 'self' ${process.env.API_URL ?? 'http://localhost:3000'};`)
    return payload
  })

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof BaseError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.apiMessage,
      })
    }

    console.error('Erro não tratado:', error)
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    })
  })

  await server.register(healthRoutes)
  await server.register(personRoutes, { prefix: '/people' })

  return server
}
