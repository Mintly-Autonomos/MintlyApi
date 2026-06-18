import { describe, expect, it } from 'vitest'
import { buildMongoUri } from './mongodb-uri'

describe('buildMongoUri', () => {
  it('usa MONGODB_URI diretamente quando definida (precedência)', () => {
    const uri = buildMongoUri({ MONGODB_URI: 'mongodb://127.0.0.1:27017/' })
    expect(uri).toBe('mongodb://127.0.0.1:27017/')
  })

  it('monta a URI a partir dos campos separados', () => {
    const uri = buildMongoUri({
      MONGODB_USER: 'alex',
      MONGODB_PASSWORD: 'secret',
      MONGODB_HOSTS: 'h0:27017,h1:27017,h2:27017',
      MONGODB_REPLICA_SET: 'atlas-abc-shard-0',
      MONGODB_AUTH_SOURCE: 'admin',
    })
    expect(uri).toBe(
      'mongodb://alex:secret@h0:27017,h1:27017,h2:27017/?ssl=true&replicaSet=atlas-abc-shard-0&authSource=admin&retryWrites=true&w=majority',
    )
  })

  it('faz URL-encode de usuário e senha com caracteres especiais', () => {
    const uri = buildMongoUri({
      MONGODB_USER: 'a@b',
      MONGODB_PASSWORD: 'p@ss:w/rd',
      MONGODB_HOSTS: 'h0:27017',
    })
    expect(uri).toContain('mongodb://a%40b:p%40ss%3Aw%2Frd@h0:27017/')
  })

  it('omite credenciais quando não há usuário (mongo local sem auth)', () => {
    const uri = buildMongoUri({ MONGODB_HOSTS: 'localhost:27017' })
    expect(uri).toBe('mongodb://localhost:27017/?ssl=true&authSource=admin&retryWrites=true&w=majority')
  })

  it('usa authSource=admin como padrão e respeita override', () => {
    expect(buildMongoUri({ MONGODB_HOSTS: 'h0:27017' })).toContain('authSource=admin')
    expect(buildMongoUri({ MONGODB_HOSTS: 'h0:27017', MONGODB_AUTH_SOURCE: 'mintly_auth' })).toContain(
      'authSource=mintly_auth',
    )
  })

  it('omite ssl quando MONGODB_TLS=false', () => {
    const uri = buildMongoUri({ MONGODB_HOSTS: 'localhost:27017', MONGODB_TLS: 'false' })
    expect(uri).not.toContain('ssl=true')
  })

  it('lança erro claro quando não há MONGODB_URI nem MONGODB_HOSTS', () => {
    expect(() => buildMongoUri({})).toThrow(/MONGODB_URI ou MONGODB_HOSTS/)
  })
})
