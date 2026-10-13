import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'

/**
 * E2E do perfil tributário (fatia 3, MIN-23) — local-only, contra Atlas
 * (env=e2e): configurar o regime, lançar receita e ler o perfil por HTTP real.
 */
describe('Restaurant tax profile E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let auth: Record<string, string>
  let cashId: string
  let revenueCatId: string

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

    const signup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', env: E2E_DB },
      body: JSON.stringify({
        person: { name: 'E2E Tributo', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Tributo Rest',
        email: `tributo_e2e_${Date.now()}@teste.com`,
        termsAccepted: true,
      }),
    })
    expect(signup.status).toBe(201)
    const { accessToken, user } = (await signup.json() as any).payload
    auth = { 'Content-Type': 'application/json', env: E2E_DB, authorization: `Bearer ${accessToken}` }

    const db = mongoConnection.getDatabase(E2E_DB)
    cashId = String((await db.collection('financial_accounts').findOne({ restaurantId: user.restaurantId, isDefault: true }))!._id)
    revenueCatId = String((await db.collection('financial_categories').findOne({ restaurantId: user.restaurantId, type: 'revenue' }))!._id)
  })

  afterAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db(E2E_DB).dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  it('configura o regime e lê o perfil tributário por HTTP real', async () => {
    const patched = await fetch(`${baseUrl}/restaurants/me`, { method: 'PATCH', headers: auth, body: JSON.stringify({ taxRegime: 'simplesNacionalAnexoI' }) })
    expect(patched.status).toBe(200)

    const created = await fetch(`${baseUrl}/financial-movements/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ direction: 'in', title: 'Vendas E2E', grossValue: 1000, date: new Date().toISOString(), accountId: cashId, categoryId: revenueCatId, paymentMethod: 'pix' }),
    })
    expect(created.status).toBe(201)

    const res = await fetch(`${baseUrl}/restaurants/me`, { headers: auth })
    expect(res.status).toBe(200)
    const { restaurant, tax } = (await res.json() as any).payload
    expect(restaurant.taxRegime).toBe('simplesNacionalAnexoI')
    expect(tax).toMatchObject({ regime: 'simplesNacionalAnexoI', monthsOfHistory: 0, rbt12: 12_000, rbt12Proportional: true, effectiveRate: 0.04, bracket: { index: 1 }, insights: [] })
  })
})
