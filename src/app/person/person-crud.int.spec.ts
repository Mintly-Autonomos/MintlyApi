import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

// Exercita a stack CRUD genérica (controller -> use case -> mongo repo) pela
// rota protegida /people: faz signup para obter um token e usa o env real.

const ENV = 'inttest_people'

const SIGNUP_BODY = {
  person: { name: 'Dono', phone: '11900000000' },
  email: 'dono@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante',
  termsAccepted: true,
}

// personSchema (lib) exige name/phone/audit — audit normalmente é do servidor,
// mas o CrudController valida o schema completo no insert/update (limitação
// conhecida: não há schema parcial para CRUD ainda).
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

  it('401 sem token (envelope AUTH-0001)', async () => {
    const res = await server.inject({ method: 'GET', url: '/people', headers: { env: ENV } })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('AUTH-0001')
  })

  it('401 com token inválido', async () => {
    const res = await server.inject({ method: 'GET', url: '/people', headers: { env: ENV, authorization: 'Bearer invalido' } })
    expect(res.statusCode).toBe(401)
  })

  it('cria, lê por id, lista, filtra, atualiza e deleta um person', async () => {
    // create
    const created = await server.inject({ method: 'POST', url: '/people', headers: auth, payload: personBody('Cliente Um') })
    expect(created.statusCode).toBe(200)
    const id = created.json().payload._id
    expect(id).toBeTruthy()

    // find by id
    const byId = await server.inject({ method: 'GET', url: `/people/${id}`, headers: auth })
    expect(byId.statusCode).toBe(200)
    expect(byId.json().payload.name).toBe('Cliente Um')

    // list (findAll + pagination)
    const list = await server.inject({ method: 'GET', url: '/people?page=1&size=10', headers: auth })
    expect(list.statusCode).toBe(200)
    expect(Array.isArray(list.json().payload)).toBe(true)
    expect(list.json().pagination.totalItems).toBeGreaterThanOrEqual(1)

    // find single (isMultipleResponse=true → ramo find())
    const find = await server.inject({ method: 'GET', url: '/people?isMultipleResponse=true', headers: auth })
    expect(find.statusCode).toBe(200)

    // update (PATCH com corpo completo — schema completo no update)
    const patched = await server.inject({ method: 'PATCH', url: `/people/${id}`, headers: auth, payload: personBody('Cliente Editado') })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().payload.name).toBe('Cliente Editado')

    // delete (204)
    const deleted = await server.inject({ method: 'DELETE', url: `/people/${id}`, headers: auth })
    expect(deleted.statusCode).toBe(204)

    // confirma remoção → 404
    const gone = await server.inject({ method: 'GET', url: `/people/${id}`, headers: auth })
    expect(gone.statusCode).toBe(404)
  })

  it('lista sem size usa o padrão de paginação', async () => {
    await server.inject({ method: 'POST', url: '/people', headers: auth, payload: personBody('Paginado') })
    const res = await server.inject({ method: 'GET', url: '/people', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().pagination.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('404 ao buscar id inexistente', async () => {
    const res = await server.inject({ method: 'GET', url: '/people/0123456789abcdef01234567', headers: auth })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('APP-0001')
  })
})
