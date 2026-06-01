import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import MongoDBConnection from '../../src/infrastructure/db/mongodb/mongodb-connection'

let memoryServer: MongoMemoryServer | undefined
let client: MongoClient | undefined

/**
 * Boota um Mongo in-memory e injeta o client no singleton MongoDBConnection.
 * Use no beforeAll do suite de integration.
 */
export async function startInMemoryMongo (): Promise<void> {
  memoryServer = await MongoMemoryServer.create()
  const uri = memoryServer.getUri()
  client = new MongoClient(uri)
  await client.connect()

  const instance = MongoDBConnection.getInstance() as any
  instance.client = client
}

/**
 * Limpa todas as collections de todos os databases já tocados.
 * Use no beforeEach pra isolar suites.
 */
export async function clearAllDatabases (): Promise<void> {
  if (!client) throw new Error('In-memory Mongo não foi iniciado')

  const admin = client.db().admin()
  const { databases } = await admin.listDatabases()
  for (const dbInfo of databases) {
    if (['admin', 'local', 'config'].includes(dbInfo.name)) continue
    const db = client.db(dbInfo.name)
    const collections = await db.collections()
    await Promise.all(collections.map(c => c.deleteMany({})))
  }
}

/**
 * Derruba o in-memory Mongo. Use no afterAll.
 */
export async function stopInMemoryMongo (): Promise<void> {
  await client?.close()
  await memoryServer?.stop()
  client = undefined
  memoryServer = undefined

  const instance = MongoDBConnection.getInstance() as any
  instance.client = null
  instance.db = null
}
