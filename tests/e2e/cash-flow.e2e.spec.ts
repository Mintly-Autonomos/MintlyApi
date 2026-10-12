import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'
const DAY = 24 * 60 * 60 * 1000

/**
 * E2E do Fluxo de Caixa (MIN-94) — local-only, contra Atlas (env=e2e). Fecha
 * também a lacuna da fatia 1: saída com vencimento por HTTP real.
 */
describe('Cash Flow E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let auth: Record<string, string>
  let cashId: string
  let expenseCatId: string

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
        person: { name: 'E2E Caixa', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Caixa Rest',
        email: `caixa_e2e_${Date.now()}@teste.com`,
        termsAccepted: true,
      }),
    })
    expect(signup.status).toBe(201)
    const { accessToken, user } = (await signup.json() as any).payload
    auth = { 'Content-Type': 'application/json', env: E2E_DB, authorization: `Bearer ${accessToken}` }

    const db = mongoConnection.getDatabase(E2E_DB)
    cashId = String((await db.collection('financial_accounts').findOne({ restaurantId: user.restaurantId, isDefault: true }))!._id)
    expenseCatId = String((await db.collection('financial_categories').findOne({ restaurantId: user.restaurantId, type: 'expense' }))!._id)
  })

  afterAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db(E2E_DB).dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  it('saída com vencimento aparece no relatório como a pagar', async () => {
    const created = await fetch(`${baseUrl}/financial-movements/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        direction: 'out',
        title: 'Boleto E2E',
        grossValue: 321.45,
        date: new Date().toISOString(),
        dueDate: new Date(Date.now() + 3 * DAY).toISOString(),
        accountId: cashId,
        categoryId: expenseCatId,
        paymentMethod: 'boleto',
      }),
    })
    expect(created.status).toBe(201)
    expect((await created.json() as any).payload.status).toBe('pending')

    const res = await fetch(`${baseUrl}/reports/cash-flow?horizon=30`, { headers: auth })
    expect(res.status).toBe(200)
    const report = (await res.json() as any).payload

    expect(report.payable).toBe(321.45)
    expect(report.projectedBalance).toBe(report.cashToday - 321.45)
    expect(report.dueItems).toEqual([expect.objectContaining({ title: 'Boleto E2E', status: 'pending', overdue: false, amount: 321.45 })])
  })
})
