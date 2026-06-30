import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'
import { mongoConnection } from '../../src/infrastructure/db/mongodb'

dotenv.config({ path: '.env.e2e' })

const E2E_DB = 'e2e'

/**
 * E2E de movimentações (MIN-69) — local-only, contra Atlas (env=e2e).
 * Cobre o fluxo ponta-a-ponta: entrada platform (pending + previsto) →
 * confirma (settled, saldo migra p/ disponível) → saída (débito) →
 * duplicidade (409 + confirmDuplicate) → edição retroativa.
 */
describe('Financial Movement E2E (Atlas, env=e2e)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let auth: Record<string, string>
  let cashId: string
  let platformId: string
  let revenueCatId: string
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

    // signup (onboarding cria conta Caixa + categorias padrão)
    const email = `mov_e2e_${Date.now()}@teste.com`
    const signup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', env: E2E_DB },
      body: JSON.stringify({
        person: { name: 'E2E Mov', phone: '11900000000' },
        password: 'Senha123',
        restaurantName: 'E2E Mov Rest',
        email,
        termsAccepted: true,
      }),
    })
    expect(signup.status).toBe(201)
    const { accessToken, user } = (await signup.json() as any).payload
    auth = { 'Content-Type': 'application/json', env: E2E_DB, authorization: `Bearer ${accessToken}` }
    const restaurantId = user.restaurantId

    // conta Caixa default + categorias do onboarding (lidas direto do banco)
    const db = mongoConnection.getDatabase(E2E_DB)
    cashId = String((await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true }))!._id)
    revenueCatId = String((await db.collection('financial_categories').findOne({ restaurantId, type: 'revenue' }))!._id)
    expenseCatId = String((await db.collection('financial_categories').findOne({ restaurantId, type: 'expense' }))!._id)

    // conta platform (com taxa/prazo)
    const plat = await fetch(`${baseUrl}/financial-accounts/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        restaurantId,
        name: 'iFood E2E',
        type: 'platform',
        status: 'active',
        isDefault: false,
        feePercent: 10,
        settlementDays: 14,
        audit: { createdAt: new Date(), updatedAt: new Date() },
      }),
    })
    expect(plat.status).toBe(201)
    platformId = (await plat.json() as any).payload._id
  })

  afterAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    await client.db(E2E_DB).dropDatabase()
    await client.close()

    await server.close()
    await mongoConnection.disconnect()
  })

  const post = (body: any) =>
    fetch(`${baseUrl}/financial-movements/`, { method: 'POST', headers: auth, body: JSON.stringify(body) })

  it('fluxo completo: entrada platform → settle → saída → duplicidade → edição retroativa', async () => {
    // 1. entrada platform → pending + saldo previsto, com data prevista
    const reg = await post({ direction: 'in', title: 'Venda app', grossValue: 100, date: '2026-06-16T00:00:00.000Z', accountId: platformId, categoryId: revenueCatId, paymentMethod: 'pix' })
    expect(reg.status).toBe(201)
    const mov = (await reg.json() as any).payload
    expect(mov.status).toBe('pending')
    expect(mov.netValue).toBe(90)
    expect(mov.predictedReceiptDate).toBeDefined()

    // 2. confirma recebimento → settled (saldo migra de previsto p/ disponível)
    const settle = await fetch(`${baseUrl}/financial-movements/${mov._id}/status`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'settled' }) })
    expect(settle.status).toBe(200)

    // 3. saída no caixa (débito), com fornecedor
    const out = await post({ direction: 'out', title: 'Compra', grossValue: 40, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: expenseCatId, paymentMethod: 'cash', counterparty: { name: 'Forn', kind: 'supplier' } })
    expect(out.status).toBe(201)

    // 4. duplicidade: mesma saída em <2min → 409; com confirmDuplicate → 201
    const dup = { direction: 'out', title: 'Dup', grossValue: 10, date: '2026-06-16T00:00:00.000Z', accountId: cashId, categoryId: expenseCatId, paymentMethod: 'cash' }
    expect((await post(dup)).status).toBe(201)
    expect((await post(dup)).status).toBe(409)
    expect((await post({ ...dup, confirmDuplicate: true })).status).toBe(201)

    // 5. edição retroativa do valor da entrada → recalcula net
    const edit = await fetch(`${baseUrl}/financial-movements/${mov._id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ grossValue: 200 }) })
    expect(edit.status).toBe(200)
    expect((await edit.json() as any).payload.netValue).toBe(180)

    // 6. listagem mais recente -> antiga
    const list = await fetch(`${baseUrl}/financial-movements/`, { headers: auth })
    expect(list.status).toBe(200)
    expect((await list.json() as any).payload.length).toBeGreaterThanOrEqual(4)
  })
})
