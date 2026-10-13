import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'

/**
 * E2E da Visão Geral (fatia 8) — local-only, contra Atlas (env=e2e): receita e
 * CMV lançados por HTTP real aparecem nos cards, nos insights e na projeção.
 */
describe('Overview E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let auth: Record<string, string>
  let cashId: string
  let revenueCatId: string
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
        person: { name: 'E2E Visao Geral', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Visao Geral Rest',
        email: `visao_geral_e2e_${Date.now()}@teste.com`,
        termsAccepted: true,
      }),
    })
    expect(signup.status).toBe(201)
    const { accessToken, user } = (await signup.json() as any).payload
    auth = { 'Content-Type': 'application/json', env: E2E_DB, authorization: `Bearer ${accessToken}` }

    const db = mongoConnection.getDatabase(E2E_DB)
    cashId = String((await db.collection('financial_accounts').findOne({ restaurantId: user.restaurantId, isDefault: true }))!._id)
    revenueCatId = String((await db.collection('financial_categories').findOne({ restaurantId: user.restaurantId, type: 'revenue' }))!._id)
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

  it('lançamentos por HTTP real aparecem na Visão Geral', async () => {
    const post = (body: Record<string, unknown>) => fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ date: new Date().toISOString(), accountId: cashId, paymentMethod: 'pix', ...body }) })
    expect((await post({ direction: 'in', title: 'Vendas E2E', grossValue: 1000, categoryId: revenueCatId })).status).toBe(201)
    expect((await post({ direction: 'out', title: 'Insumos E2E', grossValue: 400, categoryId: cmvCatId })).status).toBe(201)

    const res = await fetch(`${baseUrl}/dashboard/overview`, { headers: auth })
    expect(res.status).toBe(200)
    const o = (await res.json() as any).payload
    expect(o.cards.revenue.amount).toBe(1000)
    expect(o.cards.cmv.pct).toBeCloseTo(0.4, 10)
    expect(o.insights.map((i: any) => i.kind)).toContain('cmvAboveTarget')
    expect(o.revenueVsExpense.at(-1)).toMatchObject({ projected: true })
  })
})
