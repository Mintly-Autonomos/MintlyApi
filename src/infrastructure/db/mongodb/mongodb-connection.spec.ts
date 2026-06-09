import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import MongoDBConnection from './mongodb-connection'

const conn = MongoDBConnection.getInstance()

describe('MongoDBConnection', () => {
  describe('desconectado', () => {
    it('isConnected é false e os getters lançam', () => {
      expect(conn.isConnected()).toBe(false)
      expect(() => conn.getClient()).toThrow()
      expect(() => conn.getDatabase()).toThrow()
      expect(() => conn.getDatabase('x')).toThrow()
    })

    it('setDatabase lança quando não conectado', () => {
      expect(() => conn.setDatabase('x')).toThrow()
    })

    it('disconnect é no-op quando não conectado', async () => {
      await expect(conn.disconnect()).resolves.toBeUndefined()
    })
  })

  describe('conectado', () => {
    let mongod: MongoMemoryServer

    beforeAll(async () => {
      mongod = await MongoMemoryServer.create()
      process.env.MONGODB_URI = mongod.getUri()
      await conn.connect()
    })

    afterAll(async () => {
      await conn.disconnect()
      await mongod.stop()
    })

    it('connect é idempotente e isConnected fica true', async () => {
      await expect(conn.connect()).resolves.toBeUndefined()
      expect(conn.isConnected()).toBe(true)
    })

    it('getClient retorna o client', () => {
      expect(conn.getClient()).toBeDefined()
    })

    it('getDatabase(env) roteia pelo nome do env', () => {
      expect(conn.getDatabase('algumenv').databaseName).toBe('algumenv')
    })

    it('getDatabase() lança antes de setDatabase', () => {
      expect(() => conn.getDatabase()).toThrow()
    })

    it('setDatabase define o default e getDatabase() o retorna', () => {
      conn.setDatabase('default')
      expect(conn.getDatabase().databaseName).toBe('default')
    })
  })
})
