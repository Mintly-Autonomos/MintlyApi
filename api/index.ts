import type { IncomingMessage, ServerResponse } from 'http'
import type { FastifyInstance } from 'fastify'
import * as dotenv from 'dotenv'
import { buildServer } from '../src/infrastructure/server/build-server'
import { mongoConnection } from '../src/infrastructure/db/mongodb'

// Entrypoint serverless (Vercel). Diferente de `src/server.ts` — que roda um
// servidor de longa duração com `listen()` para dev/AWS — aqui o app é apenas
// construído e o request é encaminhado para o handler HTTP do Fastify, sem
// `listen()` nem `process.exit`. O `vercel.json` reescreve todas as rotas
// para esta função.
dotenv.config()

// Constrói o app e conecta ao Mongo uma única vez por cold start; invocações
// seguintes reusam a instância já pronta. Em caso de falha, zera o cache para
// permitir nova tentativa no próximo request (em vez de fixar a rejeição).
let appPromise: Promise<FastifyInstance> | null = null

async function bootstrap (): Promise<FastifyInstance> {
  await mongoConnection.connect()
  const app = await buildServer()
  await app.ready()
  return app
}

function getApp (): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = bootstrap().catch((error) => {
      appPromise = null
      throw error
    })
  }
  return appPromise
}

export default async function handler (req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp()
  app.server.emit('request', req, res)
}
