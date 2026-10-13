import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'

/**
 * E2E de subcategoria e canal (fatia 5) — local-only, contra Atlas (env=e2e):
 * subcategoria criada em categoria de sistema e usada num lançamento por HTTP real.
 */
describe('Subcategoria e canal E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let auth: Record<string, string>
  let cashId: string
  let cmvCatId: string

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
        person: { name: 'E2E Subcategoria', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Subcategoria Rest',
        email: `subcategoria_e2e_${Date.now()}@teste.com`,
        termsAccepted: true,
      }),
    })
    expect(signup.status).toBe(201)
    const { accessToken, user } = (await signup.json() as any).payload
    auth = { 'Content-Type': 'application/json', env: E2E_DB, authorization: `Bearer ${accessToken}` }

    const db = mongoConnection.getDatabase(E2E_DB)
    cashId = String((await db.collection('financial_accounts').findOne({ restaurantId: user.restaurantId, isDefault: true }))!._id)
    cmvCatId = String((await db.collection('financial_categories').findOne({ restaurantId: user.restaurantId, name: 'CMV/Insumos' }))!._id)
  })

  afterAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db(E2E_DB).dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  it('cria subcategoria em CMV/Insumos e lança despesa com ela e canal delivery', async () => {
    const sub = await fetch(`${baseUrl}/financial-categories/${cmvCatId}/subcategories`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Frango' }) })
    expect(sub.status).toBe(201)
    const subId = (await sub.json() as any).payload._id

    const created = await fetch(`${baseUrl}/financial-movements/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ direction: 'out', title: 'Frango E2E', grossValue: 250, date: new Date().toISOString(), accountId: cashId, categoryId: cmvCatId, subcategoryId: subId, channel: 'delivery', paymentMethod: 'pix' }),
    })
    expect(created.status).toBe(201)
    expect((await created.json() as any).payload).toMatchObject({ subcategory: { _id: subId, name: 'Frango' }, channel: 'delivery' })

    const list = await fetch(`${baseUrl}/financial-categories?name=CMV`, { headers: auth })
    const cmv = (await list.json() as any).payload.find((c: any) => c._id === cmvCatId)
    expect(cmv.subcategories).toEqual([{ _id: subId, name: 'Frango', status: 'active' }])
  })
})
