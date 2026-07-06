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

  // Aguarda a resposta terminar antes de resolver. Sem isso, a Vercel encerra a
  // invocação assim que esta função resolve — o que ocorre logo após o emit,
  // ANTES de handlers assíncronos do Fastify (qualquer `async () =>`, incluindo
  // os que consultam o Mongo) escreverem a resposta —, derrubando a função com
  // FUNCTION_INVOCATION_FAILED. Rotas síncronas (ex.: 404) escapam por responder
  // no mesmo tick; as assíncronas não. Os listeners são anexados antes do emit
  // para não haver corrida com respostas que terminam de imediato.
  await new Promise<void>((resolve, reject) => {
    res.once('finish', resolve)
    res.once('close', resolve)
    res.once('error', reject)
    app.server.emit('request', req, res)
  })
}
