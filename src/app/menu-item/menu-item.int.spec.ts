import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { ObjectId } from 'mongodb'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { MenuItemRepository } from './menu-item-repository'

const ENV = 'menuitem_1'
const DAY = 86_400_000

describe('/menu-items (integração)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>
  let a: { token: string; restaurantId: string }
  let b: { token: string; restaurantId: string }

  const signup = async (email: string, name: string) => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env: ENV },
      payload: {
        person: { name, phone: '11999990000' },
        email,
        password: 'Senha123',
        restaurantName: `Restaurante ${name}`,
        termsAccepted: true,
      },
    })
    const { payload } = res.json()
    return { token: payload.accessToken as string, restaurantId: payload.user.restaurantId as string }
  }
  const call = (method: 'GET' | 'PATCH' | 'POST', url: string, token: string, payload?: Record<string, unknown>) =>
    server.inject({ method, url, headers: { env: ENV, authorization: `Bearer ${token}` }, payload })

  const create = async (token: string, name: string, price = 38, category?: string) => {
    const res = await call('POST', '/menu-items', token, { name, price, ...(category ? { category } : {}) })
    expect(res.statusCode).toBe(201)
    return res.json().payload as { _id: string; price: number; priceUpdatedAt: string; priceReviewedAt: string }
  }
  /** Envelhece a revisão do preço direto no banco (não existe rota para isso, de propósito). */
  const backdate = async (id: string, days: number) => {
    const when = new Date(Date.now() - days * DAY)
    await mongoConnection
      .getDatabase(ENV)
      .collection('menu_items')
      .updateOne({ _id: new ObjectId(id) }, { $set: { priceReviewedAt: when, priceUpdatedAt: when } })
  }
  const alerts = async (token: string) => (await call('GET', '/menu-items/price-alerts', token)).json().payload as Array<{ _id: string; daysSinceReview: number }>
  const get = async (token: string, id: string) => {
    const list = (await call('GET', '/menu-items?isMultipleResponse=true', token)).json().payload as Array<Record<string, any>>
    return list.find((i) => i._id === id)!
  }

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
    a = await signup('a@cardapio-a.com', 'Ana')
    b = await signup('b@cardapio-b.com', 'Beto')
    await new MenuItemRepository().createIndexes({ env: ENV, restaurantId: a.restaurantId })
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  it('cadastra um prato: ativo, com as duas datas de preço em "agora"', async () => {
    const item = await create(a.token, 'Frango Yangnyeom', 38, 'Frango')
    const doc = await get(a.token, item._id)
    expect(doc.status).toBe('active')
    expect(doc.price).toBe(38)
    expect(doc.category).toBe('Frango')
    expect(doc.priceUpdatedAt).toBe(doc.priceReviewedAt)
    expect(Date.now() - new Date(doc.priceReviewedAt).getTime()).toBeLessThan(60_000)
    expect(doc.restaurantId).toBe(a.restaurantId)
  })

  it('o cliente não escolhe status, datas nem restaurante (insert estrito)', async () => {
    for (const extra of [{ status: 'inactive' }, { restaurantId: b.restaurantId }, { priceReviewedAt: '2020-01-01' }]) {
      const res = await call('POST', '/menu-items', a.token, { name: 'Intruso', price: 10, ...extra })
      expect(res.statusCode).toBe(400)
    }
  })

  it('rejeita preço negativo e nome ausente', async () => {
    expect((await call('POST', '/menu-items', a.token, { name: 'Negativo', price: -1 })).statusCode).toBe(400)
    expect((await call('POST', '/menu-items', a.token, { price: 10 })).statusCode).toBe(400)
  })

  it('nome duplicado no mesmo restaurante → 409 (sem diferenciar caixa/acento); outro restaurante pode', async () => {
    await create(a.token, 'Combo Casal')
    const dup = await call('POST', '/menu-items', a.token, { name: 'combo casal', price: 99 })
    expect(dup.statusCode).toBe(409)
    expect((await call('POST', '/menu-items', b.token, { name: 'Combo Casal', price: 99 })).statusCode).toBe(201)
  })

  it('lista só os pratos do próprio restaurante e filtra por nome', async () => {
    const list = (await call('GET', '/menu-items?isMultipleResponse=true', a.token)).json().payload as Array<{ name: string; restaurantId: string }>
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((i) => i.restaurantId === a.restaurantId)).toBe(true)
    const filtered = (await call('GET', '/menu-items?isMultipleResponse=true&name=combo', a.token)).json().payload as Array<{ name: string }>
    expect(filtered.map((i) => i.name)).toEqual(['Combo Casal'])
  })

  it('PATCH /:id edita só nome e categoria; preço e status não passam por aqui', async () => {
    const item = await create(a.token, 'Soju Original', 25)
    const ok = await call('PATCH', `/menu-items/${item._id}`, a.token, { name: 'Soju Clássico', category: 'Bebidas' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().payload).toMatchObject({ name: 'Soju Clássico', category: 'Bebidas', price: 25 })
    expect((await call('PATCH', `/menu-items/${item._id}`, a.token, { price: 1 })).statusCode).toBe(400)
    expect((await call('PATCH', `/menu-items/${item._id}`, a.token, { status: 'inactive' })).statusCode).toBe(400)
  })

  describe('aviso de revisão de preço (167 dias)', () => {
    it('só aparece quem está há 167 dias ou mais sem revisão, do mais antigo para o mais novo', async () => {
      const velho = await create(a.token, 'Prato Velho', 30)
      const limite = await create(a.token, 'Prato no Limite', 30)
      const quase = await create(a.token, 'Prato Quase', 30)
      await backdate(velho._id, 300)
      await backdate(limite._id, 168)
      await backdate(quase._id, 160)

      const lista = await alerts(a.token)
      const ids = lista.map((x) => x._id)
      expect(ids).toContain(velho._id)
      expect(ids).toContain(limite._id)
      expect(ids).not.toContain(quase._id)
      expect(ids.indexOf(velho._id)).toBeLessThan(ids.indexOf(limite._id))
      expect(lista.find((x) => x._id === velho._id)!.daysSinceReview).toBeGreaterThanOrEqual(300)
    })

    it('mudar o preço silencia o aviso, atualiza o valor e as duas datas', async () => {
      const item = await create(a.token, 'Prato Reajustado', 30)
      await backdate(item._id, 200)
      expect((await alerts(a.token)).map((x) => x._id)).toContain(item._id)

      const res = await call('PATCH', `/menu-items/${item._id}/price`, a.token, { price: 34.5 })
      expect(res.statusCode).toBe(200)
      const doc = res.json().payload
      expect(doc.price).toBe(34.5)
      expect(Date.now() - new Date(doc.priceUpdatedAt).getTime()).toBeLessThan(60_000)
      expect(doc.priceUpdatedAt).toBe(doc.priceReviewedAt)
      expect((await alerts(a.token)).map((x) => x._id)).not.toContain(item._id)
    })

    it('"não quero mudar" silencia o aviso sem mexer no valor nem em priceUpdatedAt', async () => {
      const item = await create(a.token, 'Prato Mantido', 30)
      await backdate(item._id, 200)
      const antes = await get(a.token, item._id)

      const res = await call('POST', `/menu-items/${item._id}/price-review`, a.token)
      expect(res.statusCode).toBe(200)
      const doc = res.json().payload
      expect(doc.price).toBe(30)
      expect(doc.priceUpdatedAt).toBe(antes.priceUpdatedAt)
      expect(new Date(doc.priceReviewedAt).getTime()).toBeGreaterThan(new Date(antes.priceReviewedAt).getTime())
      expect((await alerts(a.token)).map((x) => x._id)).not.toContain(item._id)
    })

    it('enviar o mesmo preço conta só como revisão (priceUpdatedAt continua sendo a última mudança real)', async () => {
      const item = await create(a.token, 'Prato Igual', 30)
      await backdate(item._id, 200)
      const antes = await get(a.token, item._id)

      const res = await call('PATCH', `/menu-items/${item._id}/price`, a.token, { price: 30 })
      const doc = res.json().payload
      expect(doc.priceUpdatedAt).toBe(antes.priceUpdatedAt)
      expect(new Date(doc.priceReviewedAt).getTime()).toBeGreaterThan(new Date(antes.priceReviewedAt).getTime())
    })

    it('prato inativo não entra nos avisos', async () => {
      const item = await create(a.token, 'Prato Inativo', 30)
      await backdate(item._id, 250)
      expect((await call('PATCH', `/menu-items/${item._id}/inactivate`, a.token)).statusCode).toBe(200)
      expect((await alerts(a.token)).map((x) => x._id)).not.toContain(item._id)
      expect((await call('PATCH', `/menu-items/${item._id}/reactivate`, a.token)).statusCode).toBe(200)
      expect((await alerts(a.token)).map((x) => x._id)).toContain(item._id)
    })

    it('preço inválido → 400, e o prato fica como estava', async () => {
      const item = await create(a.token, 'Prato Validado', 30)
      expect((await call('PATCH', `/menu-items/${item._id}/price`, a.token, { price: -5 })).statusCode).toBe(400)
      expect((await call('PATCH', `/menu-items/${item._id}/price`, a.token, {})).statusCode).toBe(400)
      expect((await get(a.token, item._id)).price).toBe(30)
    })
  })

  describe('isolamento entre restaurantes', () => {
    it('B não vê, não edita, não revisa nem inativa o prato de A (404)', async () => {
      const item = await create(a.token, 'Prato Privado', 30)
      await backdate(item._id, 300)

      expect((await call('PATCH', `/menu-items/${item._id}`, b.token, { name: 'Roubado' })).statusCode).toBe(404)
      expect((await call('PATCH', `/menu-items/${item._id}/price`, b.token, { price: 1 })).statusCode).toBe(404)
      expect((await call('POST', `/menu-items/${item._id}/price-review`, b.token)).statusCode).toBe(404)
      expect((await call('PATCH', `/menu-items/${item._id}/inactivate`, b.token)).statusCode).toBe(404)
      expect((await alerts(b.token)).map((x) => x._id)).not.toContain(item._id)

      const doc = await get(a.token, item._id)
      expect(doc.name).toBe('Prato Privado')
      expect(doc.price).toBe(30)
      expect(doc.status).toBe('active')
    })

    it('id inexistente ou malformado → 404', async () => {
      expect((await call('PATCH', `/menu-items/${new ObjectId().toString()}/price`, a.token, { price: 1 })).statusCode).toBe(404)
      expect((await call('POST', '/menu-items/nao-e-um-id/price-review', a.token)).statusCode).toBe(404)
    })
  })

  it('sem token → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/menu-items/price-alerts', headers: { env: ENV } })
    expect(res.statusCode).toBe(401)
  })
})
