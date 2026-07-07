import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { personRoutes } from '../../app/person/person-routes'
import { financialAccountRoutes } from '../../app/financial-account/financial-account-routes'
import { financialCategoryRoutes } from '../../app/financial-category/financial-category-routes'
import { financialMovementRoutes } from '../../app/financial-movement/financial-movement-routes'
import { healthRoutes } from '../../app/health/health-routes'
import { authRoutes } from '../../app/auth/auth-routes'
import { verifyJwt } from '../../core/hooks/verify-jwt'
import { BaseError } from '../../core/errors/core/base-error'
import { assertValidEnv } from '../../app/environment/env-allowlist'

export async function buildServer (server: FastifyInstance = Fastify()): Promise<FastifyInstance> {
  await server.register(cors, { origin: true })

  // Documentação (Swagger) só fora de produção: em prod, /documentation exporia
  // publicamente todo o mapa de rotas/contratos da API.
  if (process.env.NODE_ENV !== 'production') {
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
  }

  // Valida o header `env` contra a allowlist (app.valid_environments) quando
  // presente — rotas sem env (ex.: /health) passam direto; env ausente segue
  // tratado pelo MissingEnvError na montagem do contexto. Permissivo quando a
  // allowlist está vazia (dev/testes). Ver env-allowlist.ts.
  server.addHook('onRequest', async (request) => {
    const rawEnv = request.headers.env
    const env = Array.isArray(rawEnv) ? rawEnv[0] : rawEnv
    if (env && String(env).trim() !== '') {
      await assertValidEnv(String(env))
    }
  })

  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', `default-src 'self'; connect-src 'self' ${process.env.API_URL ?? 'http://localhost:3000'};`)
    return payload
  })

  server.setErrorHandler((error, _request, reply) => {
    // Erro de validação de schema do Fastify (body/params/query): 400 no mesmo
    // envelope de validação, senão cairia no 500 genérico abaixo.
    if ((error as { validation?: unknown }).validation) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as { validation?: unknown }).validation,
      })
    }

    if (error instanceof BaseError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.apiMessage,
      })
    }

    // name check além de instanceof: a lib (build CJS) lança a SapphireValidationError
    // de outro build do sapphire-core, então instanceof sozinho falha (dual package).
    if (error instanceof SapphireValidationError || (error as Error)?.name === 'SapphireValidationError') {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as SapphireValidationError).flatten().fieldErrors,
      })
    }

    console.error('Erro não tratado:', error)
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    })
  })

  await server.register(healthRoutes)
  await server.register(authRoutes, { prefix: '/auth' })

  // Rotas protegidas — exigem Bearer token válido. verifyJwt lança
  // UnauthorizedError, convertido pelo error handler no mesmo envelope (AUTH-0001).
  await server.register(async (protectedScope: FastifyInstance) => {
    protectedScope.addHook('preHandler', verifyJwt)
    await protectedScope.register(personRoutes, { prefix: '/people' })

    await protectedScope.register(financialAccountRoutes, { prefix: '/financial-accounts' })
    await protectedScope.register(financialCategoryRoutes, { prefix: '/financial-categories' })

    await protectedScope.register(financialMovementRoutes, { prefix: '/financial-movements' })
  })

  // await server.register(financialAccountRoutes, { prefix: '/financial-accounts' })

  return server
}
