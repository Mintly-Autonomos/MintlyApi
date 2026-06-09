import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'
const headers = { env: E2E_DB }

describe('Person E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string

  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('Defina MONGODB_URI no .env.e2e — copie de .env.e2e.example')
    }
    server = await buildServer()
    await mongoConnection.connect()
    await server.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3001) })
    const address = server.server.address()
    if (typeof address === 'string' || address === null) throw new Error('servidor sem endereço')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db(E2E_DB).dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  it('fluxo completo: POST → GET list → GET by id → PATCH → DELETE', async () => {
    // POST
    const postRes = await fetch(`${baseUrl}/people/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'E2E Ada', age: 42 }),
    })
    expect(postRes.status).toBe(200)
    const created = await postRes.json() as any
    const id = created.payload._id
    expect(id).toBeDefined()

    // GET list
    const listRes = await fetch(`${baseUrl}/people/`, { headers })
    expect(listRes.status).toBe(200)
    const list = await listRes.json() as any
    expect(list.payload.length).toBeGreaterThanOrEqual(1)
    expect(list.payload.some((p: any) => p.name === 'E2E Ada')).toBe(true)

    // GET by id
    const getRes = await fetch(`${baseUrl}/people/${id}`, { headers })
    expect(getRes.status).toBe(200)
    const single = await getRes.json() as any
    expect(single.payload).toMatchObject({ name: 'E2E Ada', age: 42 })

    // PATCH (parcial — só age)
    const patchRes = await fetch(`${baseUrl}/people/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ age: 43 }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json() as any
    expect(patched.payload).toMatchObject({ name: 'E2E Ada', age: 43 })

    // DELETE
    const delRes = await fetch(`${baseUrl}/people/${id}`, { method: 'DELETE', headers })
    expect(delRes.status).toBe(204)

    // GET by id após delete → 404
    const after = await fetch(`${baseUrl}/people/${id}`, { headers })
    expect(after.status).toBe(404)
  })

  it('POST com body inválido devolve 400', async () => {
    const res = await fetch(`${baseUrl}/people/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'incompleto' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.code).toBe('VALIDATION_ERROR')
  })
})
