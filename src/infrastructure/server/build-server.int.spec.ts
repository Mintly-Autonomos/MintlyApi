import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { buildServer } from './build-server'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'

describe('build-server error handler', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    server = await buildServer()
    server.get('/throw/not-found', () => {
      throw new NotFoundError(Resource.Person, 'x')
    })
    server.get('/throw/validation', () => {
      throw new SapphireValidationError([
        { path: ['name'], code: 'required', message: 'Nome é obrigatório' },
      ])
    })
    server.get('/throw/generic', () => {
      throw new Error('boom')
    })
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  it('responde com statusCode do BaseError', async () => {
    const response = await server.inject({ method: 'GET', url: '/throw/not-found' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'APP-0001' })
  })

  it('responde 400 com fieldErrors pra SapphireValidationError', async () => {
    const response = await server.inject({ method: 'GET', url: '/throw/validation' })
    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.details).toHaveProperty('name')
  })

  it('responde 500 pra Error genérico', async () => {
    const response = await server.inject({ method: 'GET', url: '/throw/generic' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
  })
})

// Integração do Achado 1/2 da review ao P4: garante que o fio entre
// buildCorsOriginChecker() e o plugin @fastify/cors realmente funciona -
// origem negada precisa só ficar sem o header de CORS (o navegador que bloqueia),
// nunca virar 500 no servidor. A spec de cors-origins.spec.ts só cobre a função
// pura; aqui sobe o servidor real e injeta requests com header Origin de verdade.
describe('build-server CORS (integração, P4)', () => {
  const ORIGINAL_CORS_ORIGINS = process.env.CORS_ORIGINS
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV

  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'https://app.mintly.com.br'
    process.env.NODE_ENV = 'production'
    server = await buildServer()
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    process.env.CORS_ORIGINS = ORIGINAL_CORS_ORIGINS
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
  })

  it('origem na allowlist: resposta traz access-control-allow-origin com aquela origem', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.mintly.com.br' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe('https://app.mintly.com.br')
  })

  it('origem fora da allowlist: NÃO traz access-control-allow-origin e NÃO é 500 (Achado 1)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://site-malicioso.com' },
    })
    // CORS não é firewall de servidor: a API responde normalmente, só sem o
    // header — quem bloqueia é o navegador do lado do cliente.
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('preflight OPTIONS de origem permitida responde adequadamente', async () => {
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://app.mintly.com.br',
        'access-control-request-method': 'GET',
      },
    })
    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('https://app.mintly.com.br')
  })

  it('requisição sem Origin (curl, cron) funciona normalmente', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
