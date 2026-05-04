import Fastify from 'fastify'
import { startServer } from './infrastructure/server/start-server'

const server = Fastify()

startServer(server).catch((error) => {
  console.error('Erro fatal ao iniciar servidor:', error)
  process.exit(1)
})
