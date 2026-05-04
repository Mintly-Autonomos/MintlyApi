import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../infrastructure/server/build-server'

describe('Mintly API server', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    server = await buildServer()
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  it('returns a healthy response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('exposes swagger documentation JSON', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/documentation/json',
    })

    const peoplePath = Object.keys(response.json().paths).find((path) => path.startsWith('/people'))

    expect(response.statusCode).toBe(200)
    expect(response.json().openapi).toBe('3.0.3')
    expect(peoplePath).toBeDefined()
  })
})
