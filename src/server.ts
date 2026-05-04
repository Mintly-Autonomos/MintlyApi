import { startServer } from './infrastructure/server/start-server'

startServer().catch((error) => {
  console.error('Erro fatal ao iniciar servidor:', error)
  process.exit(1)
})
