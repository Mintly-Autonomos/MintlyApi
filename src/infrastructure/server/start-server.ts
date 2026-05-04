import * as dotenv from 'dotenv'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../db/mongodb'
import { buildServer } from './build-server'

dotenv.config()

export async function startServer (server?: FastifyInstance) {
  const app = await buildServer(server)

  try {
    await mongoConnection.connect()
    mongoConnection.setupGracefulShutdown()
    console.log('MongoDB conectado')

    await app.listen({
      host: '0.0.0.0',
      port: Number(process.env.PORT ?? 3000),
    })

    console.log(`Servidor rodando na porta ${process.env.PORT ?? 3000}`)
  } catch (error) {
    console.error('Erro ao iniciar servidor:', error)
    process.exit(1)
  }
}
