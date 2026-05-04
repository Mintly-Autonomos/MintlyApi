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

  it('builds the swagger document', () => {
    const swaggerDocument = server.swagger() as {
      openapi?: string
      paths?: Record<string, unknown>
    }
    const peoplePath = Object.keys(swaggerDocument.paths ?? {}).find((path) => path.startsWith('/people'))

    expect(swaggerDocument.openapi).toBe('3.0.3')
    expect(swaggerDocument.paths?.['/health']).toBeDefined()
    expect(peoplePath).toBeDefined()
  })
})
