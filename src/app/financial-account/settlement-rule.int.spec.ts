import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { ensureAllIndexes } from '../../infrastructure/db/indices'
import { buildServer } from '../../infrastructure/server/build-server'

const SIGNUP_BASE = {
  person: { name: 'Dono Repasse', phone: '11966666666' },
  password: 'Senha123',
  restaurantName: 'Restaurante Repasse',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_repasse_${++envCounter}`
const day = (iso: string) => String(iso).slice(0, 10)

// Terça 27/10/2026, quarta 28/10/2026 (datas passadas: o registro recusa lançamento no futuro).
const TERCA = '2026-10-27T00:00:00.000Z'
const QUARTA = '2026-10-28T00:00:00.000Z'

describe('Regra de repasse da conta plataforma (Integration)', () => {
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
    await ensureAllIndexes(env)

    const db = mongoConnection.getDatabase(env)
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const category = await db.collection('financial_categories').insertOne({
      restaurantId: user.restaurantId,
      behavior: 'variable',
      operationalNature: 'operational',
      status: 'active',
      isSystem: false,
      audit,
      name: 'Vendas',
      type: 'revenue',
    })
    return { auth, db, categoryId: String(category.insertedId) }
  }

  const createAccount = (auth: Record<string, string>, extra: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { name: 'Keeta', type: 'platform', status: 'active', feePercent: 12, ...extra },
    })

  const sell = (auth: Record<string, string>, accountId: string, categoryId: string, date: string, title = 'Pedido') =>
    app.inject({
      method: 'POST',
      url: '/financial-movements',
      headers: auth,
      payload: { direction: 'in', title, grossValue: 100, date, accountId, categoryId, paymentMethod: 'pix' },
    })

  it('repasse toda quarta: venda na terça cai na quarta; venda na quarta só na quarta seguinte', async () => {
    const { auth, categoryId } = await setup()
    const acc = await createAccount(auth, { settlementRule: { kind: 'weekly', weekday: 3 } })
    expect(acc.statusCode).toBe(201)
    const accountId = acc.json().payload._id

    const terca = (await sell(auth, accountId, categoryId, TERCA, 'Pedido terça')).json().payload
    expect(terca).toMatchObject({ status: 'pending', settlementRuleApplied: { kind: 'weekly', weekday: 3 } })
    expect(day(terca.dueDate)).toBe('2026-10-28')
    expect(terca.netValue).toBe(88)

    const quarta = (await sell(auth, accountId, categoryId, QUARTA, 'Pedido quarta')).json().payload
    expect(day(quarta.dueDate)).toBe('2026-11-04')
  })

  it('conta criada só com o prazo antigo (settlementDays) continua funcionando', async () => {
    const { auth, categoryId } = await setup()
    const acc = await createAccount(auth, { settlementDays: 7 })
    expect(acc.statusCode).toBe(201)
    const mov = (await sell(auth, acc.json().payload._id, categoryId, TERCA)).json().payload
    expect(day(mov.dueDate)).toBe('2026-11-03')
    expect(mov.settlementDaysApplied).toBe(7)
  })

  it('regra "N dias" também preenche o settlementDays antigo na conta', async () => {
    const { auth } = await setup()
    const acc = await createAccount(auth, { settlementRule: { kind: 'afterDays', days: 3 } })
    expect(acc.json().payload).toMatchObject({ settlementDays: 3, settlementRule: { kind: 'afterDays', days: 3 } })
  })

  it('conta plataforma sem regra nem prazo é recusada', async () => {
    const { auth } = await setup()
    const acc = await createAccount(auth, {})
    expect(acc.statusCode).toBe(400)
  })

  it('regra malformada ou quinzenal com o mesmo dia é recusada', async () => {
    const { auth } = await setup()
    expect((await createAccount(auth, { settlementRule: { kind: 'weekly', weekday: 9 } })).statusCode).toBe(400)
    expect(
      (await createAccount(auth, { settlementRule: { kind: 'biweekly', firstDay: 10, secondDay: 10 } })).statusCode,
    ).toBe(400)
  })

  it('conta que não é plataforma não aceita regra de repasse', async () => {
    const { auth } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: { name: 'Banco', type: 'bank', status: 'active', settlementRule: { kind: 'weekly', weekday: 3 } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('trocar a regra da conta vale para as próximas vendas; as já feitas guardam a regra de quando nasceram', async () => {
    const { auth, categoryId } = await setup()
    const accountId = (await createAccount(auth, { settlementRule: { kind: 'weekly', weekday: 3 } })).json().payload._id
    const antiga = (await sell(auth, accountId, categoryId, TERCA, 'Antiga')).json().payload

    const patch = await app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${accountId}`,
      headers: auth,
      payload: { settlementRule: { kind: 'monthly', day: 10 } },
    })
    expect(patch.statusCode).toBe(200)

    const nova = (await sell(auth, accountId, categoryId, TERCA, 'Nova')).json().payload
    expect(day(nova.dueDate)).toBe('2026-11-10')

    // Editar a venda antiga NÃO a reprecifica com a regra nova da conta.
    const edit = await app.inject({
      method: 'PATCH',
      url: `/financial-movements/${antiga._id}`,
      headers: auth,
      payload: { title: 'Antiga (editada)' },
    })
    expect(edit.statusCode).toBe(200)
    expect(day(edit.json().payload.dueDate)).toBe('2026-10-28')

    const list = (await app.inject({ method: 'GET', url: '/financial-accounts?name=Keeta', headers: auth })).json().payload
    const account = list.find((c: any) => c._id === accountId)
    expect(account.history.some((h: any) => h.action === 'update-settlement' && /Toda quarta-feira → Todo dia 10 do mês/.test(h.detail))).toBe(true)
  })
})
