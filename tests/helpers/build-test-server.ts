import { FastifyInstance } from 'fastify'
import { buildServer } from '../../src/infrastructure/server/build-server'

/**
 * Constrói um Fastify server pronto pra fastify.inject().
 * Não conecta no Mongo — use startInMemoryMongo() separado no beforeAll.
 */
export async function buildTestServer (): Promise<FastifyInstance> {
  const server = await buildServer()
  await server.ready()
  return server
}
