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
  const app = await buildServer()

  // A Vercel parseia o corpo do request e o expõe em `req.body`, consumindo o
  // stream ANTES de repassarmos ao Fastify via emit(). Sem isto, o parser JSON
  // padrão do Fastify lê um stream já vazio e `request.body` fica undefined
  // (quebrando controllers que fazem destructuring do body, ex.: login).
  // Trocamos o parser de application/json para usar o corpo já parseado pela
  // plataforma. Aplicado só aqui (path serverless) — o dev/AWS roda com
  // listen() e o stream intacto, usando o parser padrão.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', {}, (_req, payload, done) => {
    const parsed = (payload as IncomingMessage & { body?: unknown }).body
    if (typeof parsed === 'string') {
      try {
        done(null, parsed.length > 0 ? JSON.parse(parsed) : undefined)
      } catch (error) {
        done(error as Error)
      }
      return
    }
    done(null, parsed)
  })

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

  // Conexão viva por request: em serverless a topologia do cliente cacheado
  // pode fechar entre invocações (MongoTopologyClosedError). ensureConnected
  // faz ping e reconecta se necessário.
  await mongoConnection.ensureConnected()

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
