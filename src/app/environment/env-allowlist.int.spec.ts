import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { APP_DB, resetEnvAllowlistCache } from './env-allowlist'

// Integração do C2: o hook onRequest do build-server valida o header `env`
// contra app.valid_environments. Cobre os 3 caminhos (vazio->permissivo,
// seedado+inválido->400, seedado+válido->passa) contra um Mongo real.

describe('allowlist de env (hook onRequest, integração)', () => {
  let replset: MongoMemoryReplSet
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    server = await buildServer()
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  // Rota protegida: sem token dá 401 — mas só se PASSAR do hook de env antes.
  const hit = (env: string) => server.inject({ method: 'GET', url: '/people', headers: { env } })

  it('allowlist vazia (não seedada): env arbitrário passa do hook (401 no jwt, não 400)', async () => {
    resetEnvAllowlistCache()
    const res = await hit('int-qualquer-coisa')
    expect(res.statusCode).toBe(401)
  })

  it('allowlist seedada: env fora dela → 400 APP-0004 (antes do jwt)', async () => {
    await mongoConnection.getDatabase(APP_DB).collection('valid_environments').insertMany([
      { name: 'staging' },
      { name: 'production' },
    ])
    resetEnvAllowlistCache()

    const res = await hit('ambiente-invasor')
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('APP-0004')
  })

  it('allowlist seedada: env válido passa do hook (segue p/ jwt → 401 sem token)', async () => {
    resetEnvAllowlistCache()
    const res = await hit('production')
    expect(res.statusCode).toBe(401)
  })
})
