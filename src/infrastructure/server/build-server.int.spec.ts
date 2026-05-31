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
