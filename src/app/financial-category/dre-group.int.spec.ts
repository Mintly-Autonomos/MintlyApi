import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

let envCounter = 0
const freshEnv = () => `int_dre_${++envCounter}`

describe('dreGroup na categoria (Integration)', () => {
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
      payload: { person: { name: 'Dono DRE', phone: '11977777777' }, password: 'Senha123', restaurantName: 'Rest DRE', termsAccepted: true, email: `dre_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { env, auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string, db: mongoConnection.getDatabase(env) }
  }

  const base = { behavior: 'fixed', operationalNature: 'operational', status: 'active' }
  const create = (auth: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/financial-categories', headers: auth, payload: { ...base, ...payload } })
  const patch = (auth: Record<string, string>, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/financial-categories/${id}`, headers: auth, payload })
  const stored = (db: any, id: string) => db.collection('financial_categories').findOne({ _id: new ObjectId(id) })

  it('onboarding cria as despesas de sistema com o grupo certo', async () => {
    const s = await setup()
    const docs = await s.db.collection('financial_categories').find({ restaurantId: s.restaurantId, type: 'expense' }).toArray()
    expect(Object.fromEntries(docs.map((d: any) => [d.name, d.dreGroup]))).toEqual({
      'CMV/Insumos': 'cmv', Salários: 'labor', Aluguel: 'opex', Impostos: 'tax',
    })
    const revenue = await s.db.collection('financial_categories').find({ restaurantId: s.restaurantId, type: 'revenue' }).toArray()
    expect(revenue.every((d: any) => d.dreGroup === undefined)).toBe(true)
  })

  it('cadastro de despesa sem grupo vira opex; com grupo mantém; mixed é aceito', async () => {
    const s = await setup()
    const a = await create(s.auth, { name: 'Gás', type: 'expense' })
    const b = await create(s.auth, { name: 'Pró-labore', type: 'expense', dreGroup: 'labor', behavior: 'mixed' })
    expect(a.statusCode).toBe(201)
    expect((await stored(s.db, a.json().payload._id)).dreGroup).toBe('opex')
    expect(await stored(s.db, b.json().payload._id)).toMatchObject({ dreGroup: 'labor', behavior: 'mixed' })
  })

  it('cadastro de receita com grupo → 400', async () => {
    const s = await setup()
    const res = await create(s.auth, { name: 'Venda extra', type: 'revenue', dreGroup: 'opex' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('APP-0005')
  })

  it('edição troca o grupo e preserva o resto', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Embalagens', type: 'expense' })).json().payload._id
    const res = await patch(s.auth, id, { dreGroup: 'cmv' })
    expect(res.statusCode).toBe(200)
    expect(await stored(s.db, id)).toMatchObject({ name: 'Embalagens', dreGroup: 'cmv' })
  })

  it('despesa → receita remove o grupo; receita → despesa ganha opex', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Ambígua', type: 'expense', dreGroup: 'cmv' })).json().payload._id

    expect((await patch(s.auth, id, { type: 'revenue' })).statusCode).toBe(200)
    expect((await stored(s.db, id)).dreGroup).toBeUndefined()

    expect((await patch(s.auth, id, { type: 'expense' })).statusCode).toBe(200)
    expect((await stored(s.db, id)).dreGroup).toBe('opex')
  })

  it('edição de receita mandando grupo → 400', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Venda evento', type: 'revenue' })).json().payload._id
    expect((await patch(s.auth, id, { dreGroup: 'opex' })).statusCode).toBe(400)
  })

  it('despesa antiga sem grupo (antes do backfill) pode ser editada e ganha opex', async () => {
    const s = await setup()
    const id = (await create(s.auth, { name: 'Legada', type: 'expense' })).json().payload._id
    await s.db.collection('financial_categories').updateOne({ _id: new ObjectId(id) }, { $unset: { dreGroup: '' } })

    const res = await patch(s.auth, id, { name: 'Legada 2' })

    expect(res.statusCode).toBe(200)
    expect(await stored(s.db, id)).toMatchObject({ name: 'Legada 2', dreGroup: 'opex' })
  })
})
