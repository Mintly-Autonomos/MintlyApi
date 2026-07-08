import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { ObjectId, Decimal128 } from 'mongodb'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { buildServer } from '../../../infrastructure/server/build-server'
import { FinancialAccountRepository } from '../financial-account-repository'

const SIGNUP_BASE = {
  person: { name: 'Dono Inativação', phone: '11988888888' },
  password: 'Senha123',
  restaurantName: 'Restaurante Inativação',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_inactivate_${++envCounter}`

describe('PATCH /financial-accounts/:id/inactivate', () => {
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

  // Faz signup num env isolado e devolve { auth, restaurantId }.
  // O signup já cria "Caixa" (isDefault: true) automaticamente no onboarding.
  async function setup (env: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { ...SIGNUP_BASE, email: `dono_${env}@teste.com` },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    const auth = { env, authorization: `Bearer ${accessToken}` }
    await new FinancialAccountRepository().createIndexes({ env, restaurantId: user.restaurantId })
    return { auth, restaurantId: user.restaurantId as string }
  }

  async function createAccount (auth: Record<string, string>, restaurantId: string, overrides: Record<string, any> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: auth,
      payload: {
        restaurantId,
        name: `Conta ${Math.random().toString(36).slice(2, 8)}`,
        type: 'cash',
        status: 'active',
        audit: { createdAt: new Date(), updatedAt: new Date() },
        ...overrides,
      },
    })
    expect(res.statusCode).toBe(201)
    return res.json().payload._id as string
  }

  async function getAccounts (auth: Record<string, string>) {
    const res = await app.inject({ method: 'GET', url: '/financial-accounts', headers: auth })
    return res.json().payload as Array<any>
  }

  function inactivate (auth: Record<string, string>, id: string, body: Record<string, any> = {}) {
    return app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${id}/inactivate`,
      headers: auth,
      payload: body,
    })
  }

  it('inativa uma conta válida (não-padrão, sem saldo, não única) → 200', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    // Signup já criou "Caixa" (default). Cria mais uma para que não seja a única ativa.
    const alvoId = await createAccount(auth, restaurantId, { name: 'Alvo' })

    const res = await inactivate(auth, alvoId)
    expect(res.statusCode).toBe(200)
  })

  it('bloqueia inativar a única conta ativa → 409', async () => {
    const env = freshEnv()
    const { auth } = await setup(env)
    // Signup cria apenas "Caixa". A guard "única conta ativa" é avaliada antes
    // da guard "conta padrão sem substituta", então mesmo sem passar replacementDefaultId
    // o erro retornado é o de unicidade (409).
    const [caixa] = await getAccounts(auth)
    const res = await inactivate(auth, caixa._id)
    expect(res.statusCode).toBe(409)
  })

  it('bloqueia inativar conta com saldo disponível ≠ 0 → 409', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    // Cria uma conta extra para garantir que não é a única ativa.
    await createAccount(auth, restaurantId, { name: 'Outra Ativa' })
    const comSaldoId = await createAccount(auth, restaurantId, { name: 'Com Saldo' })

    // O POST não permite abrir conta com saldo (A3): saldo real só vem de
    // movimentação. Aqui setamos direto no banco p/ montar o cenário.
    await mongoConnection.getDatabase(env).collection('financial_accounts').updateOne(
      { _id: new ObjectId(comSaldoId) },
      { $set: { availableBalance: Decimal128.fromString('100.00') } },
    )

    const res = await inactivate(auth, comSaldoId)
    expect(res.statusCode).toBe(409)
  })

  it('bloqueia inativar a conta padrão sem informar substituta → 409', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    // Cria outra conta ativa para que não seja a única — sem ela a guard
    // "única conta ativa" dispararia antes da guard "padrão sem substituta".
    await createAccount(auth, restaurantId, { name: 'Outra Ativa' })
    const accounts = await getAccounts(auth)
    const caixa = accounts.find((a: any) => a.isDefault === true)

    const res = await inactivate(auth, caixa._id) // sem replacementDefaultId
    expect(res.statusCode).toBe(409)
  })

  it('inativa a conta padrão quando uma substituta válida é informada → 200', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    const substituteId = await createAccount(auth, restaurantId, { name: 'Substituta' })
    const accounts = await getAccounts(auth)
    const caixa = accounts.find((a: any) => a.isDefault === true)

    const res = await inactivate(auth, caixa._id, { replacementDefaultId: substituteId })
    expect(res.statusCode).toBe(200)
  })
})
