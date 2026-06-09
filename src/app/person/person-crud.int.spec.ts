import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

// Exercita a stack CRUD genérica (controller -> use case -> mongo repo) pela
// rota protegida /people: faz signup para obter um token e usa o env real.
// Substitui o antigo person-routes.int.spec (que assumia /people aberta e o
// modelo Person com `age`).

const ENV = 'inttest_people'

const SIGNUP_BODY = {
  person: { name: 'Dono', phone: '11900000000' },
  email: 'dono@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante',
  termsAccepted: true,
}

// personSchema (lib) = { name, phone, audit }. O POST valida o schema completo;
// audit normalmente é do servidor, mas o CrudController não tem schema de insert
// separado ainda (PATCH já usa o partial).
const personBody = (name: string) => ({
  name,
  phone: '11911111111',
  audit: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
})

describe('/people (integração, protegida por JWT)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>
  let auth: Record<string, string>

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
    const res = await server.inject({ method: 'POST', url: '/auth/signup', headers: { env: ENV }, payload: SIGNUP_BODY })
    auth = { env: ENV, authorization: `Bearer ${res.json().payload.accessToken}` }
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  beforeEach(async () => {
    await mongoConnection.getDatabase(ENV).collection('people').deleteMany({})
  })

  const create = (name: string) =>
    server.inject({ method: 'POST', url: '/people', headers: auth, payload: personBody(name) })

  // ── guarda de autenticação ───────────────────────────────────────────────
  it('401 sem token (envelope AUTH-0001)', async () => {
    const res = await server.inject({ method: 'GET', url: '/people', headers: { env: ENV } })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('AUTH-0001')
  })

  it('401 com token inválido', async () => {
    const res = await server.inject({ method: 'GET', url: '/people', headers: { env: ENV, authorization: 'Bearer invalido' } })
    expect(res.statusCode).toBe(401)
  })

  // ── CRUD ─────────────────────────────────────────────────────────────────
  it('POST cria e devolve a pessoa com _id', async () => {
    const res = await create('Cliente Um')
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toMatchObject({ name: 'Cliente Um', phone: '11911111111' })
    expect(res.json().payload._id).toBeDefined()
  })

  it('POST com body inválido (sem phone/audit) devolve 400', async () => {
    const res = await server.inject({ method: 'POST', url: '/people', headers: auth, payload: { name: 'Só nome' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })

  it('GET /:id devolve a pessoa criada', async () => {
    const id = (await create('Cliente Um')).json().payload._id
    const res = await server.inject({ method: 'GET', url: `/people/${id}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload.name).toBe('Cliente Um')
  })

  it('GET /:id inexistente devolve 404', async () => {
    const res = await server.inject({ method: 'GET', url: '/people/507f1f77bcf86cd799439011', headers: auth })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('APP-0001')
  })

  it('GET ?isMultipleResponse=true&name=X chama find (single)', async () => {
    await create('Ada')
    await create('Bob')
    const res = await server.inject({ method: 'GET', url: '/people?isMultipleResponse=true&name=Ada', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toMatchObject({ name: 'Ada' })
  })

  it('GET lista com paginação', async () => {
    await create('A')
    await create('B')
    const res = await server.inject({ method: 'GET', url: '/people?page=1&size=10', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toHaveLength(2)
    expect(res.json().pagination).toMatchObject({ totalItems: 2, totalPages: 1 })
  })

  it('GET lista sem size usa o padrão de paginação', async () => {
    await create('Paginado')
    const res = await server.inject({ method: 'GET', url: '/people', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().pagination.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('PATCH atualiza só os campos enviados (schema parcial)', async () => {
    const id = (await create('Cliente Um')).json().payload._id
    const res = await server.inject({ method: 'PATCH', url: `/people/${id}`, headers: auth, payload: { name: 'Cliente Editado' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().payload).toMatchObject({ name: 'Cliente Editado', phone: '11911111111' })
  })

  it('PATCH com body parcial inválido devolve 400', async () => {
    const id = (await create('Cliente Um')).json().payload._id
    const res = await server.inject({ method: 'PATCH', url: `/people/${id}`, headers: auth, payload: { name: 12345 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })

  it('DELETE remove e devolve 204', async () => {
    const id = (await create('Cliente Um')).json().payload._id
    const res = await server.inject({ method: 'DELETE', url: `/people/${id}`, headers: auth })
    expect(res.statusCode).toBe(204)
    const gone = await server.inject({ method: 'GET', url: `/people/${id}`, headers: auth })
    expect(gone.statusCode).toBe(404)
  })

  it('DELETE de id inexistente devolve 500 (comportamento atual do repo)', async () => {
    const res = await server.inject({ method: 'DELETE', url: '/people/507f1f77bcf86cd799439011', headers: auth })
    expect(res.statusCode).toBe(500)
  })
})
