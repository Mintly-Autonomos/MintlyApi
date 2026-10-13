import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

let envCounter = 0
const freshEnv = () => `int_sub_${++envCounter}`

describe('subcategorias da categoria (Integration)', () => {
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

  async function setup (env = freshEnv(), tag = 'a') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Rest ${tag}`, termsAccepted: true, email: `sub_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string, db: mongoConnection.getDatabase(env) }
  }

  const cmvId = async (db: any, restaurantId: string) => String((await db.collection('financial_categories').findOne({ restaurantId, name: 'CMV/Insumos' }))._id)
  const post = (auth: Record<string, string>, catId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/financial-categories/${catId}/subcategories`, headers: auth, payload: payload as any })
  const patch = (auth: Record<string, string>, url: string, payload?: unknown) =>
    app.inject({ method: 'PATCH', url: `/financial-categories/${url}`, headers: auth, payload: payload as any })
  const stored = (db: any, id: string) => db.collection('financial_categories').findOne({ _id: new ObjectId(id) })

  it('onboarding cria as categorias com a lista vazia', async () => {
    const s = await setup()
    expect((await stored(s.db, await cmvId(s.db, s.restaurantId))).subcategories).toEqual([])
  })

  it('cria subcategoria em categoria de sistema (CMV/Insumos) → 201', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)

    const res = await post(s.auth, id, { name: '  Frango  ' })

    expect(res.statusCode).toBe(201)
    expect(res.json().payload).toMatchObject({ name: 'Frango', status: 'active' })
    const doc = await stored(s.db, id)
    expect(doc.subcategories).toHaveLength(1)
    expect(doc.history.at(-1)).toMatchObject({ action: 'subcategory:add', detail: 'Frango' })
    expect(doc.audit.updatedBy).toBeDefined()
  })

  it('categoria antiga sem o campo subcategories: o primeiro POST cria a lista', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    await s.db.collection('financial_categories').updateOne({ _id: new ObjectId(id) }, { $unset: { subcategories: '' } })

    expect((await post(s.auth, id, { name: 'Óleo' })).statusCode).toBe(201)
    expect((await stored(s.db, id)).subcategories).toHaveLength(1)
  })

  it('nome repetido (maiúsculas/espaços) → 409; vazio → 400; longo → 400; sem corpo → 400', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    await post(s.auth, id, { name: 'Frango' })

    expect((await post(s.auth, id, { name: ' frango ' })).statusCode).toBe(409)
    expect((await post(s.auth, id, { name: '   ' })).statusCode).toBe(400)
    expect((await post(s.auth, id, { name: 'x'.repeat(61) })).statusCode).toBe(400)
    expect((await post(s.auth, id, undefined)).statusCode).toBe(400)
    expect((await stored(s.db, id)).subcategories).toHaveLength(1)
  })

  it('renomeia, inativa e reativa, com history', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    const subId = (await post(s.auth, id, { name: 'Embalagem' })).json().payload._id

    expect((await patch(s.auth, `${id}/subcategories/${subId}`, { name: 'Embalagens' })).json().payload.name).toBe('Embalagens')
    expect((await patch(s.auth, `${id}/subcategories/${subId}/inactivate`)).json().payload.status).toBe('inactive')
    expect((await patch(s.auth, `${id}/subcategories/${subId}/reactivate`)).json().payload.status).toBe('active')

    const doc = await stored(s.db, id)
    expect(doc.subcategories).toEqual([{ _id: subId, name: 'Embalagens', status: 'active' }])
    expect(doc.history.slice(-3).map((h: any) => h.action)).toEqual(['subcategory:rename', 'subcategory:inactivate', 'subcategory:reactivate'])
  })

  it('renomear para nome de outra subcategoria → 409; inativar duas vezes é idempotente', async () => {
    const s = await setup()
    const id = await cmvId(s.db, s.restaurantId)
    await post(s.auth, id, { name: 'Frango' })
    const subId = (await post(s.auth, id, { name: 'Óleo' })).json().payload._id

    expect((await patch(s.auth, `${id}/subcategories/${subId}`, { name: 'FRANGO' })).statusCode).toBe(409)
    await patch(s.auth, `${id}/subcategories/${subId}/inactivate`)
    expect((await patch(s.auth, `${id}/subcategories/${subId}/inactivate`)).statusCode).toBe(200)
    expect((await stored(s.db, id)).history.filter((h: any) => h.action === 'subcategory:inactivate')).toHaveLength(1)
  })

  it('categoria de outro restaurante, id inválido ou subcategoria inexistente → 404', async () => {
    const env = freshEnv()
    const a = await setup(env, 'a')
    const b = await setup(env, 'b')
    const idA = await cmvId(a.db, a.restaurantId)

    expect((await post(b.auth, idA, { name: 'Intruso' })).statusCode).toBe(404)
    expect((await post(a.auth, 'nao-e-id', { name: 'X' })).statusCode).toBe(404)
    expect((await patch(a.auth, `${idA}/subcategories/${new ObjectId().toHexString()}`, { name: 'X' })).statusCode).toBe(404)
    expect((await patch(a.auth, `${idA}/subcategories/${new ObjectId().toHexString()}/inactivate`)).statusCode).toBe(404)
    expect((await stored(a.db, idA)).subcategories).toEqual([])
  })

  it('cadastro e edição da categoria recusam subcategories no corpo → 400', async () => {
    const s = await setup()
    const created = await app.inject({ method: 'POST', url: '/financial-categories', headers: s.auth, payload: { name: 'Nova', type: 'expense', behavior: 'fixed', operationalNature: 'operational', status: 'active', subcategories: [] } })
    expect(created.statusCode).toBe(400)

    const ok = await app.inject({ method: 'POST', url: '/financial-categories', headers: s.auth, payload: { name: 'Nova', type: 'expense', behavior: 'fixed', operationalNature: 'operational', status: 'active' } })
    expect(ok.statusCode).toBe(201)
    expect((await stored(s.db, ok.json().payload._id)).subcategories).toEqual([])
    expect((await patch(s.auth, ok.json().payload._id, { subcategories: [] })).statusCode).toBe(400)
  })
})
