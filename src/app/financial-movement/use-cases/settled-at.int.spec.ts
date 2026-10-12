import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../../financial-account/financial-account-repository'
import { FinancialMovementRepository } from '../financial-movement-repository'
import { SettleDueMovementsUseCase } from './settle-due-movements.use-case'
import { addDaysToDay, toLocalDay } from '../../reports/shared/period'

const DAY = 24 * 60 * 60 * 1000
let envCounter = 0
const freshEnv = () => `int_settled_${++envCounter}`

describe('settledAt — quando o dinheiro mexeu (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  async function setup () {
    const env = freshEnv()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: {
        person: { name: 'Dono Settled', phone: '11977777777' },
        password: 'Senha123',
        restaurantName: 'Restaurante Settled',
        termsAccepted: true,
        email: `dono_${env}@teste.com`,
      },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId

    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })

    const db = mongoConnection.getDatabase(env)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const category = (type: 'revenue' | 'expense', name: string) => db.collection('financial_categories').insertOne({
      restaurantId, name, type, behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit,
    })
    const revenue = await category('revenue', 'Vendas')
    const expense = await category('expense', 'Fornecedores')
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })

    return { auth, env, restaurantId, db, cashId: String(cash!._id), revenueCatId: String(revenue.insertedId), expenseCatId: String(expense.insertedId) }
  }

  const register = (auth: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: { paymentMethod: 'pix', confirmDuplicate: true, ...payload } })

  const stored = async (db: any, id: string) => db.collection('financial_movements').findOne({ _id: new ObjectId(id) })

  it('registro à vista nasce com settledAt = date', async () => {
    const s = await setup()
    const date = new Date(Date.now() - 3 * DAY)
    const res = await register(s.auth, { direction: 'out', title: 'Gás', grossValue: 100, date: date.toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    expect(res.statusCode).toBe(201)

    const doc = await stored(s.db, res.json().payload._id)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt.toISOString()).toBe(date.toISOString())
  })

  it('registro com vencimento nasce pendente e sem settledAt', async () => {
    const s = await setup()
    const res = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 100, date: new Date().toISOString(), dueDate: new Date(Date.now() + 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })

    const doc = await stored(s.db, res.json().payload._id)
    expect(doc.status).toBe('pending')
    expect(doc.settledAt).toBeUndefined()
  })

  it('PATCH status com settledAt informado grava a data informada', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto atrasado', grossValue: 200, date: new Date(Date.now() - 10 * DAY).toISOString(), dueDate: new Date(Date.now() - 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const paidAt = new Date(Date.now() - 3 * DAY).toISOString()

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: paidAt } })

    expect(res.statusCode).toBe(200)
    expect(new Date(res.json().payload.settledAt).toISOString()).toBe(paidAt)
    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(paidAt)
  })

  it('PATCH status sem settledAt grava agora', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const before = Date.now()

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled' } })

    const settledAt = (await stored(s.db, id)).settledAt.getTime()
    expect(settledAt).toBeGreaterThanOrEqual(before)
    expect(settledAt).toBeLessThanOrEqual(Date.now())
  })

  it('PATCH status aceita relógio do cliente até 5 minutos adiantado', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${created.json().payload._id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: new Date(Date.now() + 60 * 1000).toISOString() } })

    expect(res.statusCode).toBe(200)
  })

  it('PATCH status recusa settledAt no futuro e data inválida', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    const future = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: new Date(Date.now() + DAY).toISOString() } })
    const garbage = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: 'ontem' } })

    expect(future.statusCode).toBe(400)
    expect(future.json().code).toBe('APP-0005')
    expect(garbage.statusCode).toBe(400)
    expect((await stored(s.db, id)).status).toBe('pending')
  })

  it('voltar para pendente remove o settledAt', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Gás', grossValue: 100, date: new Date().toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'pending' } })

    expect((await stored(s.db, id)).settledAt).toBeUndefined()
  })

  it('liquidação automática grava settledAt = dueDate', async () => {
    const s = await setup()
    const platform = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: s.auth,
      payload: { restaurantId: s.restaurantId, name: 'iFood', type: 'platform', status: 'active', feePercent: 10, settlementDays: 30, audit: { createdAt: new Date(), updatedAt: new Date() } },
    })
    const created = await register(s.auth, { direction: 'in', title: 'Pedido', grossValue: 100, date: new Date(Date.now() - 40 * DAY).toISOString(), accountId: platform.json().payload._id, categoryId: s.revenueCatId })
    const id = created.json().payload._id
    const dueDate = (await stored(s.db, id)).dueDate

    await new SettleDueMovementsUseCase().execute({ env: s.env })

    const doc = await stored(s.db, id)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt.toISOString()).toBe(dueDate.toISOString())
  })

  it('edição que remove o vencimento liquida com settledAt = date', async () => {
    const s = await setup()
    const date = new Date(Date.now() - 2 * DAY)
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 100, date: date.toISOString(), dueDate: new Date(Date.now() + 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: { dueDate: null } })

    expect(res.statusCode).toBe(200)
    const doc = await stored(s.db, id)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt.toISOString()).toBe(date.toISOString())
  })

  it('edição de campo inócuo em liquidada preserva o settledAt', async () => {
    const s = await setup()
    const date = new Date(Date.now() - 2 * DAY)
    const created = await register(s.auth, { direction: 'out', title: 'Gás', grossValue: 100, date: date.toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: { title: 'Gás de cozinha' } })

    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(date.toISOString())
  })
  // Revisão final — achado 1: o front manda "AAAA-MM-DD" (seletor de data). Lido
  // como meia-noite UTC, cairia às 21h do dia ANTERIOR em São Paulo.
  it('PATCH status com settledAt só com data fica no próprio dia local', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 200, date: new Date(Date.now() - 10 * DAY).toISOString(), dueDate: new Date(Date.now() - 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const paidDay = addDaysToDay(toLocalDay(new Date()), -3)

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: paidDay } })

    expect(res.statusCode).toBe(200)
    expect(toLocalDay((await stored(s.db, id)).settledAt)).toBe(paidDay)
  })

  it('PATCH status com settledAt só com data: hoje aceita, amanhã recusa', async () => {
    const s = await setup()
    const today = toLocalDay(new Date())
    const a = await register(s.auth, { direction: 'out', title: 'Boleto A', grossValue: 200, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const b = await register(s.auth, { direction: 'out', title: 'Boleto B', grossValue: 300, date: new Date().toISOString(), dueDate: new Date(Date.now() + 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })

    const ok = await app.inject({ method: 'PATCH', url: `/financial-movements/${a.json().payload._id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: today } })
    const tomorrow = await app.inject({ method: 'PATCH', url: `/financial-movements/${b.json().payload._id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: addDaysToDay(today, 1) } })

    expect(ok.statusCode).toBe(200)
    expect(tomorrow.statusCode).toBe(400)
  })

  // Achado 2: à vista tem settledAt = date; corrigir a data tem que mover o
  // dia em que o dinheiro mexeu.
  it('editar a data de um lançamento à vista move o settledAt junto', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Compra no mercado', grossValue: 100, date: new Date(Date.now() - 2 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const newDate = new Date(Date.now() - 4 * DAY)

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: { date: newDate.toISOString() } })

    expect(res.statusCode).toBe(200)
    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(newDate.toISOString())
  })

  it('editar a data não sobrescreve um settledAt informado pelo dono', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 100, date: new Date(Date.now() - 6 * DAY).toISOString(), dueDate: new Date(Date.now() - 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    const paidAt = new Date(Date.now() - 3 * DAY).toISOString()
    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: paidAt } })

    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload: { date: new Date(Date.now() - 7 * DAY).toISOString() } })

    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(paidAt)
  })

  // Achado 3: corrigir "quando paguei" numa movimentação já liquidada não pode
  // devolver 200 sem gravar nada.
  it('PATCH reafirmando settled com settledAt corrige a data de liquidação', async () => {
    const s = await setup()
    const created = await register(s.auth, { direction: 'out', title: 'Boleto', grossValue: 100, date: new Date(Date.now() - 6 * DAY).toISOString(), dueDate: new Date(Date.now() - 5 * DAY).toISOString(), accountId: s.cashId, categoryId: s.expenseCatId })
    const id = created.json().payload._id
    await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled' } })
    const corrected = new Date(Date.now() - 4 * DAY).toISOString()

    const res = await app.inject({ method: 'PATCH', url: `/financial-movements/${id}/status`, headers: s.auth, payload: { status: 'settled', settledAt: corrected } })

    expect(res.statusCode).toBe(200)
    expect(new Date(res.json().payload.settledAt).toISOString()).toBe(corrected)
    expect((await stored(s.db, id)).settledAt.toISOString()).toBe(corrected)
  })
})
