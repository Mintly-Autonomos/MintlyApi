import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { ensureAllIndexes } from '../../infrastructure/db/indices'
import { buildServer } from '../../infrastructure/server/build-server'

const SIGNUP_BASE = {
  person: { name: 'Dono Pratos', phone: '11955555555' },
  password: 'Senha123',
  restaurantName: 'Restaurante Pratos',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_pratos_${++envCounter}`

describe('Pratos vendidos na movimentação (Integration)', () => {
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
      payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId
    await ensureAllIndexes(env)

    const db = mongoConnection.getDatabase(env)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const category = await db.collection('financial_categories').insertOne({
      restaurantId, behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit, name: 'Vendas', type: 'revenue',
    })
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })
    const dish = async (name: string, price: number, status = 'active', owner = restaurantId) => {
      const r = await db.collection('menu_items').insertOne({
        restaurantId: owner, name, price, cost: 0, soldPerMonth: 0, status, priceUpdatedAt: new Date(), priceReviewedAt: new Date(), audit,
      })
      return String(r.insertedId)
    }
    return { auth, db, restaurantId, categoryId: String(category.insertedId), accountId: String(cash!._id), dish }
  }

  const register = (auth: Record<string, string>, base: { accountId: string, categoryId: string }, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: {
        direction: 'in',
        title: 'Pedido 8547',
        grossValue: 100,
        date: '2026-10-29T00:00:00.000Z',
        paymentMethod: 'pix',
        accountId: base.accountId,
        categoryId: base.categoryId,
        ...extra,
      },
    })

  it('a venda guarda os pratos com nome e preço copiados do cardápio', async () => {
    const s = await setup()
    const arroz = await s.dish('Arroz', 12.5)
    const batata = await s.dish('Batata Rústica', 18)

    const res = await register(s.auth, s, { items: [{ menuItemId: arroz, qty: 2 }, { menuItemId: batata, qty: 1 }] })
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.items).toEqual([
      { menuItemId: arroz, name: 'Arroz', qty: 2, unitPrice: 12.5 },
      { menuItemId: batata, name: 'Batata Rústica', qty: 1, unitPrice: 18 },
    ])
  })

  it('nome e preço enviados pelo cliente são ignorados (o servidor copia do cardápio)', async () => {
    const s = await setup()
    const arroz = await s.dish('Arroz', 12.5)
    const res = await register(s.auth, s, { items: [{ menuItemId: arroz, qty: 1, name: 'Lagosta', unitPrice: 9999 }] })
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.items).toEqual([{ menuItemId: arroz, name: 'Arroz', qty: 1, unitPrice: 12.5 }])
  })

  it('o mesmo prato repetido soma as quantidades', async () => {
    const s = await setup()
    const arroz = await s.dish('Arroz', 12.5)
    const res = await register(s.auth, s, { items: [{ menuItemId: arroz, qty: 1 }, { menuItemId: arroz, qty: 2 }] })
    expect(res.json().payload.items).toEqual([{ menuItemId: arroz, name: 'Arroz', qty: 3, unitPrice: 12.5 }])
  })

  it('reajustar o prato depois não muda a venda antiga', async () => {
    const s = await setup()
    const arroz = await s.dish('Arroz', 12.5)
    const id = (await register(s.auth, s, { items: [{ menuItemId: arroz, qty: 1 }] })).json().payload._id
    await s.db.collection('menu_items').updateOne({ _id: new ObjectId(arroz) }, { $set: { price: 20, name: 'Arroz Branco' } })

    const list = (await app.inject({ method: 'GET', url: '/financial-movements', headers: s.auth })).json().payload
    const mov = list.find((m: any) => m._id === id)
    expect(mov.items).toEqual([{ menuItemId: arroz, name: 'Arroz', qty: 1, unitPrice: 12.5 }])
  })

  it('prato de outro restaurante, inexistente ou id inválido é recusado e nada é gravado', async () => {
    const s = await setup()
    const outro = await setup()
    const alheio = await outro.dish('Do vizinho', 10)
    for (const menuItemId of [alheio, new ObjectId().toHexString(), 'nao-e-id']) {
      const res = await register(s.auth, s, { items: [{ menuItemId, qty: 1 }] })
      expect(res.statusCode).toBe(400)
    }
    expect(await s.db.collection('financial_movements').countDocuments({})).toBe(0)
  })

  it('prato fora do cardápio (inativo) não entra numa venda nova', async () => {
    const s = await setup()
    const velho = await s.dish('Prato antigo', 30, 'inactive')
    const res = await register(s.auth, s, { items: [{ menuItemId: velho, qty: 1 }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/fora do cardápio/)
  })

  it('venda sem pratos continua funcionando', async () => {
    const s = await setup()
    const res = await register(s.auth, s)
    expect(res.statusCode).toBe(201)
    expect(res.json().payload.items).toBeUndefined()
  })

  describe('edição', () => {
    const patch = (s: Awaited<ReturnType<typeof setup>>, id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: s.auth, payload })

    it('trocar a lista de pratos; editar outro campo mantém os pratos; lista vazia remove', async () => {
      const s = await setup()
      const arroz = await s.dish('Arroz', 12.5)
      const batata = await s.dish('Batata', 18)
      const id = (await register(s.auth, s, { items: [{ menuItemId: arroz, qty: 1 }] })).json().payload._id

      const trocou = await patch(s, id, { items: [{ menuItemId: batata, qty: 2 }] })
      expect(trocou.json().payload.items).toEqual([{ menuItemId: batata, name: 'Batata', qty: 2, unitPrice: 18 }])

      const titulo = await patch(s, id, { title: 'Pedido 8547 (editado)' })
      expect(titulo.json().payload.items).toEqual([{ menuItemId: batata, name: 'Batata', qty: 2, unitPrice: 18 }])

      const limpou = await patch(s, id, { items: [] })
      expect(limpou.statusCode).toBe(200)
      expect(limpou.json().payload.items).toBeUndefined()
    })

    it('um prato que já estava na venda e saiu do cardápio depois pode continuar nela', async () => {
      const s = await setup()
      const arroz = await s.dish('Arroz', 12.5)
      const id = (await register(s.auth, s, { items: [{ menuItemId: arroz, qty: 1 }] })).json().payload._id
      await s.db.collection('menu_items').updateOne({ _id: new ObjectId(arroz) }, { $set: { status: 'inactive' } })

      const res = await patch(s, id, { items: [{ menuItemId: arroz, qty: 3 }] })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.items[0]).toMatchObject({ menuItemId: arroz, qty: 3 })
    })
  })

  it('a importação em massa aceita os pratos da linha e recusa a linha com prato inválido', async () => {
    const s = await setup()
    const arroz = await s.dish('Arroz', 12.5)
    const linha = (n: number, items: unknown) => ({
      row: n,
      direction: 'in',
      title: `Pedido ${n}`,
      grossValue: 50,
      date: '2026-10-29T00:00:00.000Z',
      paymentMethod: 'pix',
      accountId: s.accountId,
      categoryId: s.categoryId,
      items,
    })
    const ok = await app.inject({
      method: 'POST',
      url: '/financial-movements/import',
      headers: s.auth,
      payload: { idempotencyKey: 'pratos-ok-12345', rows: [linha(1, [{ menuItemId: arroz, qty: 2 }])] },
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().payload.results[0].movement.items).toEqual([{ menuItemId: arroz, name: 'Arroz', qty: 2, unitPrice: 12.5 }])

    const ruim = await app.inject({
      method: 'POST',
      url: '/financial-movements/import',
      headers: s.auth,
      payload: { idempotencyKey: 'pratos-ruim-1234', rows: [linha(2, [{ menuItemId: arroz, qty: 1 }]), linha(3, [{ menuItemId: new ObjectId().toHexString(), qty: 1 }])] },
    })
    const linha3 = ruim.json().payload.results.find((r: any) => r.row === 3)
    expect(linha3.status).toBe('failed')
  })
})
