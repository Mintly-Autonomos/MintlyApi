import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../financial-account/financial-account-repository'
import { FinancialMovementRepository } from './financial-movement-repository'
import { toLocalDay, toLocalMonth } from '../reports/shared/period'

const SIGNUP_BASE = {
  person: { name: 'Dono Maquininha', phone: '11966666666' },
  password: 'Senha123',
  restaurantName: 'Restaurante Maquininha',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_maq_${++envCounter}`

describe('Maquininha e taxa por forma de pagamento (S3.3, integração)', () => {
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
    const res = await app.inject({ method: 'POST', url: '/auth/signup', headers: { env }, payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` } })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId
    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })
    const db = mongoConnection.getDatabase(env)
    const stone = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { name: 'Stone', type: 'platform', status: 'active', feePercent: 2.5, settlementDays: 0, platformKind: 'cardMachine', feeByMethod: { debit: 1, credit: 3, pix: 0.5 } },
    })
    expect(stone.statusCode).toBe(201)
    const ifood = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { name: 'iFood', type: 'platform', status: 'active', feePercent: 12, settlementDays: 0 },
    })
    expect(ifood.statusCode).toBe(201)
    const bank = await app.inject({ method: 'POST', url: '/financial-accounts', headers: auth, payload: { name: 'Nubank', type: 'bank', status: 'active' } })
    const revenue = await db.collection('financial_categories').insertOne({
      restaurantId, name: 'Vendas', type: 'revenue', behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit: { createdAt: new Date(), updatedAt: new Date() },
    })
    return {
      auth,
      stoneId: stone.json().payload._id as string,
      ifoodId: ifood.json().payload._id as string,
      bankId: bank.json().payload._id as string,
      revenueId: String(revenue.insertedId),
      stone: stone.json().payload,
    }
  }

  const today = () => toLocalDay(new Date())
  const sale = (auth: any, accountId: string, categoryId: string, paymentMethod: string, grossValue: number) =>
    app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: { direction: 'in', title: `Venda ${paymentMethod}`, grossValue, date: today(), accountId, categoryId, paymentMethod } })

  it('a conta guarda o tipo e a taxa por forma; conta que não é plataforma não aceita', async () => {
    const { auth, stone, bankId } = await setup()
    expect(stone).toMatchObject({ platformKind: 'cardMachine', feeByMethod: { debit: 1, credit: 3, pix: 0.5 }, feePercent: 2.5 })
    const res = await app.inject({ method: 'PATCH', url: `/financial-accounts/${bankId}`, headers: auth, payload: { platformKind: 'cardMachine' } })
    expect(res.statusCode).toBe(409)
  })

  it('a venda paga a taxa da forma de pagamento; forma sem taxa própria usa a da conta', async () => {
    const { auth, stoneId, revenueId } = await setup()
    const credito = (await sale(auth, stoneId, revenueId, 'credit', 1_000)).json().payload
    const pix = (await sale(auth, stoneId, revenueId, 'pix', 1_000)).json().payload
    const carteira = (await sale(auth, stoneId, revenueId, 'digitalWallet', 1_000)).json().payload
    expect(credito).toMatchObject({ feeValue: 30, netValue: 970, feePercentApplied: 3 })
    expect(pix).toMatchObject({ feeValue: 5, netValue: 995, feePercentApplied: 0.5 })
    expect(carteira).toMatchObject({ feeValue: 25, netValue: 975, feePercentApplied: 2.5 })
  })

  it('trocar a forma na edição troca a taxa; editar outro campo mantém a taxa gravada', async () => {
    const { auth, stoneId, revenueId } = await setup()
    const mov = (await sale(auth, stoneId, revenueId, 'credit', 1_000)).json().payload
    // A conta passa a cobrar mais no crédito: editar o título não reprecifica.
    await app.inject({ method: 'PATCH', url: `/financial-accounts/${stoneId}`, headers: auth, payload: { feeByMethod: { debit: 1, credit: 4, pix: 0.5 } } })
    const titulo = await app.inject({ method: 'PATCH', url: `/financial-movements/${mov._id}`, headers: auth, payload: { title: 'Mesa 4' } })
    expect(titulo.json().payload).toMatchObject({ feeValue: 30, feePercentApplied: 3 })
    const debito = await app.inject({ method: 'PATCH', url: `/financial-movements/${mov._id}`, headers: auth, payload: { paymentMethod: 'debit' } })
    expect(debito.statusCode).toBe(200)
    expect(debito.json().payload).toMatchObject({ feeValue: 10, netValue: 990, feePercentApplied: 1 })
  })

  it('Resultado: "Taxa da maquininha" numa linha, comissão do app em outra', async () => {
    const { auth, stoneId, ifoodId, revenueId } = await setup()
    await sale(auth, stoneId, revenueId, 'credit', 1_000)
    await sale(auth, ifoodId, revenueId, 'pix', 500)
    const r = (await app.inject({ method: 'GET', url: `/reports/result?month=${toLocalMonth(new Date())}`, headers: auth })).json().payload
    const itens = Object.fromEntries(r.operatingExpenseItems.map((i: any) => [i.kind, i]))
    expect(itens.cardFee).toMatchObject({ name: 'Taxa da maquininha', amount: 30 })
    expect(itens.platformFee).toMatchObject({ name: 'Taxa de plataforma', amount: 60 })
    expect(r.current.operatingExpenses).toBe(90)
  })

  it('Custos: taxa da maquininha separada; a venda da maquininha é salão', async () => {
    const { auth, stoneId, ifoodId, revenueId } = await setup()
    await sale(auth, stoneId, revenueId, 'credit', 1_000)
    await sale(auth, ifoodId, revenueId, 'pix', 500)
    const month = toLocalMonth(new Date())
    const e = (await app.inject({ method: 'GET', url: `/reports/expenses?month=${month}`, headers: auth })).json().payload
    expect(e.platformFee).toMatchObject({ amount: 60, deliveryRevenue: 500, pctOfDelivery: 0.12 })
    expect(e.cardFee).toMatchObject({ amount: 30, cardRevenue: 1_000, pctOfCardRevenue: 0.03 })
    expect(e.items.find((i: any) => i.key === `cardFee:${stoneId}`)).toMatchObject({ kind: 'cardFee', name: 'Taxa Stone', amount: 30 })
    const salao = (await app.inject({ method: 'GET', url: `/reports/expenses?month=${month}&channel=dineIn`, headers: auth })).json().payload
    expect(salao.revenue.current).toBe(1_000)
    expect(salao.items.map((i: any) => i.kind)).toEqual(['cardFee'])
  })

  it('a maquininha antiga cadastrada como app passa a ser maquininha trocando o tipo', async () => {
    const { auth, ifoodId, revenueId } = await setup()
    await sale(auth, ifoodId, revenueId, 'credit', 1_000)
    const patch = await app.inject({ method: 'PATCH', url: `/financial-accounts/${ifoodId}`, headers: auth, payload: { platformKind: 'cardMachine' } })
    expect(patch.statusCode).toBe(200)
    const r = (await app.inject({ method: 'GET', url: `/reports/result?month=${toLocalMonth(new Date())}`, headers: auth })).json().payload
    expect(r.operatingExpenseItems.map((i: any) => i.kind)).toEqual(['cardFee'])
  })
})
