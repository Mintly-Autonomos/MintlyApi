import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'

/**
 * E2E de Custos & Despesas (fatia 6) — local-only, contra Atlas (env=e2e): CMV e
 * venda em conta de plataforma lançados por HTTP real aparecem no relatório.
 */
describe('Expenses E2E (Atlas, env=e2e)', () => {
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
        person: { name: 'E2E Custos', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Custos Rest',
        email: `custos_e2e_${Date.now()}@teste.com`,
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

  it('CMV e venda em plataforma com taxa aparecem em Custos por HTTP real', async () => {
    const platform = await fetch(`${baseUrl}/financial-accounts/`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'iFood E2E', type: 'platform', feePercent: 20, settlementDays: 30, status: 'active' }) })
    expect(platform.status).toBe(201)
    const platformId = (await platform.json() as any).payload._id

    const post = (body: Record<string, unknown>) => fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ date: new Date().toISOString(), paymentMethod: 'pix', ...body }) })
    expect((await post({ direction: 'in', title: 'Delivery E2E', grossValue: 1000, accountId: platformId, categoryId: revenueCatId })).status).toBe(201)
    expect((await post({ direction: 'out', title: 'Insumos E2E', grossValue: 300, accountId: cashId, categoryId: cmvCatId })).status).toBe(201)

    const res = await fetch(`${baseUrl}/reports/expenses`, { headers: auth })
    expect(res.status).toBe(200)
    const r = (await res.json() as any).payload
    expect(r).toMatchObject({ total: { current: 500 }, cmv: { amount: 300 }, platformFee: { amount: 200, deliveryRevenue: 1000 } })
    expect(r.items.map((i: any) => i.name)).toEqual(['CMV/Insumos', 'Taxa iFood E2E'])
  })

  it('subcategoria criada e usada aparece como subitem do CMV', async () => {
    const sub = await fetch(`${baseUrl}/financial-categories/${cmvCatId}/subcategories`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Frango' }) })
    expect(sub.status).toBe(201)
    const subId = (await sub.json() as any).payload._id
    const created = await fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify({ direction: 'out', title: 'Frango E2E', grossValue: 120, date: new Date().toISOString(), accountId: cashId, categoryId: cmvCatId, subcategoryId: subId, paymentMethod: 'pix' }) })
    expect(created.status).toBe(201)

    const r = (await (await fetch(`${baseUrl}/reports/expenses`, { headers: auth })).json() as any).payload
    const cmv = r.items.find((i: any) => i.categoryId === cmvCatId)

    expect(cmv.subitems.map((s: any) => [s.name, s.amount])).toEqual([['Frango', 120], ['Sem subitem', 300]])
    expect(r.projection).not.toBeNull()
  })
})
