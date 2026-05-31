import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildTestServer } from '../../../tests/helpers/build-test-server'
import { startInMemoryMongo, stopInMemoryMongo, clearAllDatabases } from '../../../tests/helpers/in-memory-mongo'

describe('Person routes (integration)', () => {
  let server: Awaited<ReturnType<typeof buildTestServer>>
  const headers = { env: 'int-test' }

  beforeAll(async () => {
    await startInMemoryMongo()
    server = await buildTestServer()
  })

  afterAll(async () => {
    await server.close()
    await stopInMemoryMongo()
  })

  beforeEach(async () => {
    await clearAllDatabases()
  })

  it('POST /people cria e devolve a pessoa com _id', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/people/',
      headers,
      payload: { name: 'Ada', age: 30 },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.payload).toMatchObject({ name: 'Ada', age: 30 })
    expect(body.payload._id).toBeDefined()
  })

  it('POST /people com body inválido devolve 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/people/',
      headers,
      payload: { name: 'Ada' }, // age faltando
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
  })

  it('GET /people/:id devolve a pessoa criada', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/people/',
      headers,
      payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'GET', url: `/people/${id}`, headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().payload).toMatchObject({ name: 'Ada', age: 30 })
  })

  it('GET /people/:id com id inexistente devolve 404', async () => {
    const response = await server.inject({
      method: 'GET', url: '/people/507f1f77bcf86cd799439011', headers,
    })
    expect(response.statusCode).toBe(404)
  })

  it('GET /people?isMultipleResponse=true&name=X chama find (single)', async () => {
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'Ada', age: 30 } })
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'Bob', age: 40 } })

    const response = await server.inject({
      method: 'GET',
      url: '/people/?isMultipleResponse=true&name=Ada',
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().payload).toMatchObject({ name: 'Ada' })
  })

  it('GET /people lista todas as pessoas com paginação', async () => {
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'A', age: 1 } })
    await server.inject({ method: 'POST', url: '/people/', headers, payload: { name: 'B', age: 2 } })

    const response = await server.inject({ method: 'GET', url: '/people/', headers })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.payload).toHaveLength(2)
    expect(body.pagination).toMatchObject({ totalItems: 2, totalPages: 1 })
  })

  it('PATCH /people/:id atualiza só os campos enviados', async () => {
    const created = await server.inject({
      method: 'POST', url: '/people/', headers, payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'PATCH',
      url: `/people/${id}`,
      headers,
      payload: { age: 31 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().payload).toMatchObject({ name: 'Ada', age: 31 })
  })

  it('PATCH com body parcial inválido devolve 400', async () => {
    const created = await server.inject({
      method: 'POST', url: '/people/', headers, payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'PATCH',
      url: `/people/${id}`,
      headers,
      payload: { age: 'não é número' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
  })

  it('DELETE /people/:id remove e devolve 204', async () => {
    const created = await server.inject({
      method: 'POST', url: '/people/', headers, payload: { name: 'Ada', age: 30 },
    })
    const id = created.json().payload._id

    const response = await server.inject({
      method: 'DELETE', url: `/people/${id}`, headers,
    })
    expect(response.statusCode).toBe(204)
  })

  it('DELETE /people/:id de id inexistente devolve 500 (currently)', async () => {
    // Documenta o comportamento atual: o repository lança Error genérico
    // quando o id não existe, e cai no fallback 500. Quando for migrado pra
    // NotFoundError, este teste vira 404.
    const response = await server.inject({
      method: 'DELETE', url: '/people/507f1f77bcf86cd799439011', headers,
    })
    expect(response.statusCode).toBe(500)
  })
})
