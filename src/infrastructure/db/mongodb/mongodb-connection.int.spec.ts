import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import MongoDBConnection from './mongodb-connection'

describe('MongoDBConnection (integration)', () => {
  let memory: MongoMemoryServer
  let prevUri: string | undefined

  beforeAll(async () => {
    memory = await MongoMemoryServer.create()
    prevUri = process.env.MONGODB_URI
    process.env.MONGODB_URI = memory.getUri()
    // Garantir singleton limpo no início
    const instance = MongoDBConnection.getInstance() as any
    if (instance.client) {
      try { await instance.client.close() } catch { /* ignore */ }
    }
    instance.client = null
    instance.db = null
  })

  afterAll(async () => {
    const instance = MongoDBConnection.getInstance() as any
    if (instance.client) {
      try { await instance.client.close() } catch { /* ignore */ }
    }
    instance.client = null
    instance.db = null
    await memory.stop()
    if (prevUri !== undefined) {
      process.env.MONGODB_URI = prevUri
    } else {
      delete process.env.MONGODB_URI
    }
  })

  it('getClient antes de connect lança Error', () => {
    const conn = MongoDBConnection.getInstance()
    expect(() => conn.getClient()).toThrow(/não está conectado/)
  })

  it('getDatabase antes de connect lança Error', () => {
    const conn = MongoDBConnection.getInstance()
    expect(() => conn.getDatabase('any')).toThrow(/não está conectado/)
  })

  it('connect estabelece conexão', async () => {
    const conn = MongoDBConnection.getInstance()
    await conn.connect()
    expect(conn.isConnected()).toBe(true)
  })

  it('connect quando já conectado é no-op (não recria client)', async () => {
    const conn = MongoDBConnection.getInstance()
    const clientBefore = conn.getClient()
    await conn.connect()
    expect(conn.getClient()).toBe(clientBefore)
  })

  it('getClient devolve o client após connect', () => {
    const conn = MongoDBConnection.getInstance()
    expect(conn.getClient()).toBeDefined()
  })

  it('getDatabase com env devolve database específica', () => {
    const conn = MongoDBConnection.getInstance()
    const db = conn.getDatabase('test-env')
    expect(db.databaseName).toBe('test-env')
  })

  it('getDatabase sem env e sem setDatabase lança Error', () => {
    const conn = MongoDBConnection.getInstance()
    const instance = conn as any
    instance.db = null
    expect(() => conn.getDatabase()).toThrow(/não está conectado/)
  })

  it('setDatabase + getDatabase sem env devolve a default', () => {
    const conn = MongoDBConnection.getInstance()
    conn.setDatabase('default-db')
    expect(conn.getDatabase().databaseName).toBe('default-db')
  })

  it('setupGracefulShutdown registra handlers SIGINT/SIGTERM/SIGUSR2', () => {
    const conn = MongoDBConnection.getInstance()
    const before = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGUSR2: process.listenerCount('SIGUSR2'),
    }
    conn.setupGracefulShutdown()
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1)
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1)
    expect(process.listenerCount('SIGUSR2')).toBe(before.SIGUSR2 + 1)
  })

  it('disconnect fecha o client', async () => {
    const conn = MongoDBConnection.getInstance()
    await conn.disconnect()
    expect(conn.isConnected()).toBe(false)
  })

  it('disconnect quando já desconectado é no-op', async () => {
    const conn = MongoDBConnection.getInstance()
    await conn.disconnect()
    expect(conn.isConnected()).toBe(false)
  })
})
