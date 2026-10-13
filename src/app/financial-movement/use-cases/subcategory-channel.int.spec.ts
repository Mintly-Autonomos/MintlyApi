import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../../financial-account/financial-account-repository'
import { FinancialMovementRepository } from '../financial-movement-repository'

let envCounter = 0
const freshEnv = () => `int_subch_${++envCounter}`

describe('subcategoria e canal na movimentação (Integration)', () => {
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

  const addSub = (auth: Record<string, string>, catId: string, name: string) =>
    app.inject({ method: 'POST', url: `/financial-categories/${catId}/subcategories`, headers: auth, payload: { name } })

  async function setup (env = freshEnv(), tag = 'a') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: 'Senha123', restaurantName: `Rest ${tag}`, termsAccepted: true, email: `subch_${tag}_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId
    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })

    const db = mongoConnection.getDatabase(env)
    const byName = async (name: string) => String((await db.collection('financial_categories').findOne({ restaurantId, name }))!._id)
    const cmvId = await byName('CMV/Insumos')
    const aluguelId = await byName('Aluguel')
    const cash = await db.collection('financial_accounts').findOne({ restaurantId, isDefault: true })
    const frangoId = (await addSub(auth, cmvId, 'Frango')).json().payload._id as string
    const oleoId = (await addSub(auth, cmvId, 'Óleo')).json().payload._id as string

    return { auth, restaurantId, db, cashId: String(cash!._id), cmvId, aluguelId, frangoId, oleoId }
  }

  const register = (auth: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/financial-movements', headers: auth, payload: { direction: 'out', title: 'Compra', grossValue: 100, date: new Date().toISOString(), paymentMethod: 'pix', confirmDuplicate: true, ...payload } })
  const update = (auth: Record<string, string>, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/financial-movements/${id}`, headers: auth, payload })
  const inactivate = (s: any, subId: string) =>
    app.inject({ method: 'PATCH', url: `/financial-categories/${s.cmvId}/subcategories/${subId}/inactivate`, headers: s.auth })
  const stored = (db: any, id: string) => db.collection('financial_movements').findOne({ _id: new ObjectId(id) })

  it('registra com subcategoria e canal', async () => {
    const s = await setup()

    const res = await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId, channel: 'delivery' })

    expect(res.statusCode).toBe(201)
    expect(await stored(s.db, res.json().payload._id)).toMatchObject({ subcategory: { _id: s.frangoId, name: 'Frango' }, channel: 'delivery' })
  })

  it('sem subcategoria nem canal: nenhum dos dois campos é gravado', async () => {
    const s = await setup()
    const doc = await stored(s.db, (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId })).json().payload._id)
    expect(doc.subcategory).toBeUndefined()
    expect(doc.channel).toBeUndefined()
  })

  it('subcategoria de outra categoria, inativa ou de outro restaurante → 400; canal fora do enum → 400; nada gravado', async () => {
    const env = freshEnv()
    const s = await setup(env, 'a')
    const other = await setup(env, 'b')
    await inactivate(s, s.oleoId)

    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.aluguelId, subcategoryId: s.frangoId })).statusCode).toBe(400)
    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.oleoId })).statusCode).toBe(400)
    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: other.frangoId })).statusCode).toBe(400)
    expect((await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, channel: 'drive-thru' })).statusCode).toBe(400)
    expect(await s.db.collection('financial_movements').countDocuments({ restaurantId: s.restaurantId })).toBe(0)
  })

  it('edição: trocar a categoria limpa a subcategoria; null limpa subcategoria e canal', async () => {
    const s = await setup()
    const a = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId, channel: 'dineIn' })).json().payload._id
    expect((await update(s.auth, a, { categoryId: s.aluguelId })).statusCode).toBe(200)
    expect(await stored(s.db, a)).toMatchObject({ category: { _id: s.aluguelId }, channel: 'dineIn' })
    expect((await stored(s.db, a)).subcategory).toBeUndefined()

    const b = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId, channel: 'dineIn' })).json().payload._id
    expect((await update(s.auth, b, { subcategoryId: null, channel: null })).statusCode).toBe(200)
    const doc = await stored(s.db, b)
    expect(doc.subcategory).toBeUndefined()
    expect(doc.channel).toBeUndefined()
  })

  it('edição: canal novo grava; canal inválido → 400 sem alterar', async () => {
    const s = await setup()
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId })).json().payload._id
    expect((await update(s.auth, id, { channel: 'shared' })).statusCode).toBe(200)
    expect((await update(s.auth, id, { channel: 'drive-thru' })).statusCode).toBe(400)
    expect((await stored(s.db, id)).channel).toBe('shared')
  })

  it('lançamento antigo com subcategoria depois inativada: editar o título funciona e a mantém', async () => {
    const s = await setup()
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.oleoId })).json().payload._id
    await inactivate(s, s.oleoId)

    const res = await update(s.auth, id, { title: 'Óleo de soja' })

    expect(res.statusCode).toBe(200)
    expect((await stored(s.db, id)).subcategory).toEqual({ _id: s.oleoId, name: 'Óleo' })
    expect((await update(s.auth, id, { subcategoryId: s.oleoId })).statusCode).toBe(200)
  })

  it('renomear a subcategoria não reescreve lançamentos gravados', async () => {
    const s = await setup()
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId })).json().payload._id
    await app.inject({ method: 'PATCH', url: `/financial-categories/${s.cmvId}/subcategories/${s.frangoId}`, headers: s.auth, payload: { name: 'Frango inteiro' } })
    expect((await stored(s.db, id)).subcategory.name).toBe('Frango')
  })

  it('trocar para outra subcategoria da mesma categoria; para uma inativa → 400', async () => {
    const s = await setup()
    const extra = (await addSub(s.auth, s.cmvId, 'Molhos')).json().payload._id
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId })).json().payload._id

    expect((await update(s.auth, id, { subcategoryId: extra })).statusCode).toBe(200)
    expect((await stored(s.db, id)).subcategory).toEqual({ _id: extra, name: 'Molhos' })

    await inactivate(s, s.oleoId)
    expect((await update(s.auth, id, { subcategoryId: s.oleoId })).statusCode).toBe(400)
    expect((await stored(s.db, id)).subcategory).toEqual({ _id: extra, name: 'Molhos' })
  })

  it('trocar categoria e subcategoria juntas valida contra a categoria nova', async () => {
    const s = await setup()
    const aluguelSub = (await addSub(s.auth, s.aluguelId, 'Loja centro')).json().payload._id
    const id = (await register(s.auth, { accountId: s.cashId, categoryId: s.cmvId, subcategoryId: s.frangoId })).json().payload._id

    expect((await update(s.auth, id, { categoryId: s.aluguelId, subcategoryId: s.frangoId })).statusCode).toBe(400)
    expect((await update(s.auth, id, { categoryId: s.aluguelId, subcategoryId: aluguelSub })).statusCode).toBe(200)
    expect((await stored(s.db, id)).subcategory).toEqual({ _id: aluguelSub, name: 'Loja centro' })
  })
})
