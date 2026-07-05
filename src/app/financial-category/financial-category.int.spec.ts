import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { FinancialCategoryRepository } from './financial-category-repository'

const SIGNUP_BASE = {
  person: { name: 'Dono Categoria', phone: '11977777777' },
  password: 'Senha123',
  restaurantName: 'Restaurante Categoria',
  termsAccepted: true,
}

let envCounter = 0
const freshEnv = () => `int_category_${++envCounter}`

describe('Financial Category (Integration)', () => {
  let app: FastifyInstance
  let replset: MongoMemoryReplSet

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
    await new FinancialCategoryRepository().createIndexes({ env, restaurantId: user.restaurantId })
    return { auth, restaurantId: user.restaurantId as string }
  }

  function createCategory (auth: Record<string, string>, restaurantId: string, overrides: Record<string, any> = {}) {
    return app.inject({
      method: 'POST',
      url: '/financial-categories',
      headers: auth,
      payload: {
        restaurantId,
        name: `Categoria ${Math.random().toString(36).slice(2, 8)}`,
        type: 'revenue',
        behavior: 'variable',
        operationalNature: 'operational',
        status: 'active',
        isSystem: false,
        audit: { createdAt: new Date(), updatedAt: new Date() },
        ...overrides,
      },
    })
  }

  function getCategories (auth: Record<string, string>, query = '') {
    return app.inject({ method: 'GET', url: `/financial-categories${query}`, headers: auth })
  }

  it('cria uma categoria custom com sucesso (201) e força isSystem:false mesmo se o body mandar true', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)

    const res = await createCategory(auth, restaurantId, { isSystem: true })

    expect(res.statusCode).toBe(201)
    const body = res.json().payload
    expect(body._id).toBeDefined()
    expect(body.isSystem).toBe(false)
    expect(body.usage).toBe(0)
    expect(body.history).toEqual([])
  })

  it('bloqueia criação de categoria duplicada (mesmo name+type) → 409', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    await createCategory(auth, restaurantId, { name: 'Categoria Fixa' })

    const res = await createCategory(auth, restaurantId, { name: 'Categoria Fixa' })

    expect(res.statusCode).toBe(409)
  })

  it('lista as 6 categorias padrão criadas no onboarding, ativas em ordem alfabética', async () => {
    const env = freshEnv()
    const { auth } = await setup(env)

    const res = await getCategories(auth)

    expect(res.statusCode).toBe(200)
    const categories = res.json().payload as Array<any>
    expect(categories).toHaveLength(6)
    expect(categories.every(c => c.isSystem === true)).toBe(true)
    expect(categories.every(c => c.status === 'active')).toBe(true)
    const names = categories.map(c => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt')))
  })

  it('lista categorias mesmo com isMultipleResponse=true na query (parâmetro fixo do HttpBaseClient.findAll da mintly-lib)', async () => {
    const env = freshEnv()
    const { auth } = await setup(env)

    const res = await getCategories(auth, '?isMultipleResponse=true')

    expect(res.statusCode).toBe(200)
    const categories = res.json().payload as Array<any>
    expect(categories).toHaveLength(6)
  })

  it('lista só as categorias do restaurante autenticado — isolamento multi-tenant', async () => {
    const env1 = freshEnv()
    const env2 = freshEnv()
    const { auth: auth1, restaurantId: rid1 } = await setup(env1)
    const { auth: auth2 } = await setup(env2)
    await createCategory(auth1, rid1, { name: 'Só do Restaurante 1' })

    const res = await getCategories(auth2)

    const categories = res.json().payload as Array<any>
    expect(categories.some(c => c.name === 'Só do Restaurante 1')).toBe(false)
  })

  it('busca por name é case-insensitive', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    await createCategory(auth, restaurantId, { name: 'Taxas de Delivery' })

    const res = await getCategories(auth, '?name=taxas')

    const categories = res.json().payload as Array<any>
    expect(categories.some(c => c.name === 'Taxas de Delivery')).toBe(true)
  })

  it('bloqueia edição via PATCH quando a categoria é isSystem → 409', async () => {
    const env = freshEnv()
    const { auth } = await setup(env)
    const [systemCategory] = (await getCategories(auth)).json().payload

    const res = await app.inject({
      method: 'PATCH',
      url: `/financial-categories/${systemCategory._id}`,
      headers: auth,
      payload: { name: 'Tentativa de renomear' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('bloqueia PATCH em categoria de outro restaurante → 404 (não 409, não 200)', async () => {
    const env1 = freshEnv()
    const env2 = freshEnv()
    const { auth: auth1, restaurantId: rid1 } = await setup(env1)
    const { auth: auth2 } = await setup(env2)
    const created = await createCategory(auth1, rid1, { name: 'Só do Restaurante 1' })
    const { _id } = created.json().payload

    const res = await app.inject({
      method: 'PATCH',
      url: `/financial-categories/${_id}`,
      headers: auth2,
      payload: { name: 'Tentativa cross-tenant' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('permite editar campos de uma categoria custom via PATCH', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    const created = await createCategory(auth, restaurantId, { name: 'Editável' })
    const { _id } = created.json().payload

    const res = await app.inject({
      method: 'PATCH',
      url: `/financial-categories/${_id}`,
      headers: auth,
      payload: { name: 'Editada' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().payload.name).toBe('Editada')
  })

  it('bloqueia tentativa de mudar status pelo PATCH genérico, mesmo em categoria custom → 409', async () => {
    const env = freshEnv()
    const { auth, restaurantId } = await setup(env)
    const created = await createCategory(auth, restaurantId, { name: 'Alvo Status' })
    const { _id } = created.json().payload

    const res = await app.inject({
      method: 'PATCH',
      url: `/financial-categories/${_id}`,
      headers: auth,
      payload: { status: 'inactive' },
    })

    expect(res.statusCode).toBe(409)
  })

  describe('GET /financial-categories/suggestions', () => {
    it('retorna só categorias ativas do tipo revenue para direction=in', async () => {
      const env = freshEnv()
      const { auth } = await setup(env)

      const res = await app.inject({ method: 'GET', url: '/financial-categories/suggestions?direction=in', headers: auth })

      expect(res.statusCode).toBe(200)
      const categories = res.json().payload as Array<any>
      expect(categories.every(c => c.type === 'revenue')).toBe(true)
      expect(categories.every(c => c.status === 'active')).toBe(true)
    })

    it('retorna só categorias ativas do tipo expense para direction=out', async () => {
      const env = freshEnv()
      const { auth } = await setup(env)

      const res = await app.inject({ method: 'GET', url: '/financial-categories/suggestions?direction=out', headers: auth })

      expect(res.statusCode).toBe(200)
      const categories = res.json().payload as Array<any>
      expect(categories.every(c => c.type === 'expense')).toBe(true)
    })

    it('rejeita direction inválida com 400', async () => {
      const env = freshEnv()
      const { auth } = await setup(env)

      const res = await app.inject({ method: 'GET', url: '/financial-categories/suggestions?direction=sideways', headers: auth })

      expect(res.statusCode).toBe(400)
    })
  })
})
