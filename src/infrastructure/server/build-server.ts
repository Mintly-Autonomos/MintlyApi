import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { personRoutes } from '../../app/person/person-routes'
import { financialAccountRoutes } from '../../app/financial-account/financial-account-routes'
import { financialCategoryRoutes } from '../../app/financial-category/financial-category-routes'
import { menuItemRoutes } from '../../app/menu-item/menu-item-routes'
import { financialMovementRoutes } from '../../app/financial-movement/financial-movement-routes'
import { cashFlowRoutes } from '../../app/reports/cash-flow/cash-flow-routes'
import { resultRoutes } from '../../app/reports/result/result-routes'
import { expensesRoutes } from '../../app/reports/expenses/expenses-routes'
import { overviewRoutes } from '../../app/dashboard/overview-routes'
import { restaurantRoutes } from '../../app/restaurant/restaurant-routes'
import { healthRoutes } from '../../app/health/health-routes'
import { authRoutes } from '../../app/auth/auth-routes'
import { verifyJwt } from '../../core/hooks/verify-jwt'
import { requireActiveSubscription } from '../../core/hooks/require-active-subscription'
import { subscriptionRoutes, webhookRoutes } from '../../app/subscription/subscription-routes'
import { BaseError } from '../../core/errors/core/base-error'
import { assertValidEnv } from '../../app/environment/env-allowlist'
import { buildCorsOriginChecker } from '../../core/config/cors-origins'

// O default do Fastify (1 MiB) estoura com a foto de perfil: 1 MB de imagem vira ~1,4 MB em
// base64 dentro do JSON do signup. 2 MiB cobre o teto da foto com folga, sem abrir demais.
const BODY_LIMIT_BYTES = 2 * 1024 * 1024

export async function buildServer (server: FastifyInstance = Fastify({ bodyLimit: BODY_LIMIT_BYTES })): Promise<FastifyInstance> {
  // Allowlist por CORS_ORIGINS (P4) — ver core/config/cors-origins.ts.
  // Negar CORS NÃO é bloquear a requisição no servidor: é só omitir o header
  // `Access-Control-Allow-Origin` na resposta. Quem recusa é o navegador, do lado
  // do cliente — a API responde normalmente. Por isso o callback recebe `false`
  // sem erro; passar um `Error` faria o @fastify/cors chamar `next(error)`, que cairia
  // no setErrorHandler genérico abaixo e devolveria 500, poluindo logs/alertas como
  // se fosse bug real a cada origem não cadastrada (esperado em produção).
  const isOriginAllowed = buildCorsOriginChecker()
  await server.register(cors, {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin))
    },
  })

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

  // Webhooks dos provedores de pagamento: PÚBLICOS (o provedor não manda JWT). A segurança está na
  // assinatura do aviso e em reconsultar o pagamento no provedor — ver SubscriptionController.
  await server.register(webhookRoutes, { prefix: '/webhooks' })

  // Assinatura: exige login, mas fica FORA do portão de assinatura — é por aqui que quem não tem assina.
  await server.register(async (subscriptionScope: FastifyInstance) => {
    subscriptionScope.addHook('preHandler', verifyJwt)
    await subscriptionScope.register(subscriptionRoutes, { prefix: '/subscription' })
  })

  // Rotas protegidas — exigem Bearer token válido. verifyJwt lança
  // UnauthorizedError, convertido pelo error handler no mesmo envelope (AUTH-0001).
  // E exigem ASSINATURA VÁLIDA: sem ela, 402 (SUBSCRIPTION-0001) e o front leva à tela de assinatura.
  await server.register(async (protectedScope: FastifyInstance) => {
    protectedScope.addHook('preHandler', verifyJwt)
    protectedScope.addHook('preHandler', requireActiveSubscription)
    await protectedScope.register(personRoutes, { prefix: '/people' })

    await protectedScope.register(financialAccountRoutes, { prefix: '/financial-accounts' })
    await protectedScope.register(financialCategoryRoutes, { prefix: '/financial-categories' })
    await protectedScope.register(menuItemRoutes, { prefix: '/menu-items' })

    await protectedScope.register(financialMovementRoutes, { prefix: '/financial-movements' })
    await protectedScope.register(cashFlowRoutes, { prefix: '/reports' })
    await protectedScope.register(resultRoutes, { prefix: '/reports' })
    await protectedScope.register(expensesRoutes, { prefix: '/reports' })
    await protectedScope.register(overviewRoutes, { prefix: '/dashboard' })
    await protectedScope.register(restaurantRoutes, { prefix: '/restaurants' })
  })

  // await server.register(financialAccountRoutes, { prefix: '/financial-accounts' })

  return server
}
