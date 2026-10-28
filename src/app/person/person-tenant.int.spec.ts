import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'

// Isolamento entre restaurantes no CRUD genérico de /people: quem se cadastrou (signup) no
// restaurante A não pode ser listado, lido, alterado nem apagado por um token do restaurante B.

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHhM3JQAAAABJRU5ErkJggg=='
const ENV = 'tenantpeople_1'

describe('/people — isolamento entre restaurantes (integração)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>
  let a: { token: string; personId: string }
  let b: { token: string; personId: string }

  const signup = async (email: string, name: string, avatar?: string) => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env: ENV },
      payload: {
        person: { name, phone: '11999990000', ...(avatar ? { avatar } : {}) },
        email,
        password: 'Senha123',
        restaurantName: `Restaurante ${name}`,
        termsAccepted: true,
      },
    })
    const { payload } = res.json()
    return { token: payload.accessToken as string, personId: payload.user.person._id as string }
  }
  const call = (method: 'GET' | 'PATCH' | 'DELETE' | 'POST', url: string, token: string, payload?: Record<string, unknown>) =>
    server.inject({ method, url, headers: { env: ENV, authorization: `Bearer ${token}` }, payload })

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
    a = await signup('a@restaurante-a.com', 'Ana (A)', PNG)
    b = await signup('b@restaurante-b.com', 'Beto (B)')
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  it('GET /people (B) não lista a pessoa — nem a foto — do restaurante A', async () => {
    const res = await call('GET', '/people?isMultipleResponse=true', b.token)
    expect(res.statusCode).toBe(200)
    const body = JSON.stringify(res.json().payload)
    expect(body).not.toContain('Ana (A)')
    expect(body).not.toContain(PNG)
  })

  it('GET /people/:id (B) na pessoa de A devolve 404', async () => {
    expect((await call('GET', `/people/${a.personId}`, b.token)).statusCode).toBe(404)
  })

  it('PATCH /people/:id (B) na pessoa de A devolve 404 e não altera nada', async () => {
    const res = await call('PATCH', `/people/${a.personId}`, b.token, { name: 'Invadida', avatar: PNG })
    expect(res.statusCode).toBe(404)
    const db = mongoConnection.getDatabase(ENV)
    const doc = await db.collection('people').findOne({ name: { $in: ['Ana (A)', 'Invadida'] } })
    expect(doc?.name).toBe('Ana (A)')
  })

  it('DELETE /people/:id (B) na pessoa de A devolve 404 e não apaga', async () => {
    expect((await call('DELETE', `/people/${a.personId}`, b.token)).statusCode).toBe(404)
    const db = mongoConnection.getDatabase(ENV)
    expect(await db.collection('people').countDocuments({ name: 'Ana (A)' })).toBe(1)
  })

  it('o restaurante A também não alcança a pessoa de B', async () => {
    expect((await call('GET', `/people/${b.personId}`, a.token)).statusCode).toBe(404)
  })

  it('pessoa criada por POST /people fica visível só pro restaurante que criou', async () => {
    const now = new Date().toISOString()
    const created = await call('POST', '/people', a.token, { name: 'Contato do A', phone: '11888880000', audit: { createdAt: now, updatedAt: now } })
    expect(created.statusCode).toBe(200)
    const id = created.json().payload._id
    expect((await call('GET', `/people/${id}`, a.token)).statusCode).toBe(200)
    expect((await call('GET', `/people/${id}`, b.token)).statusCode).toBe(404)
  })

  it('o restaurantId vindo no body/query não vence o do token', async () => {
    const res = await call('GET', '/people?isMultipleResponse=true&restaurantId=qualquer', b.token)
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json().payload)).not.toContain('Ana (A)')
  })
})
