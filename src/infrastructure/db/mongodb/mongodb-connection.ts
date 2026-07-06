import { MongoClient, Db } from 'mongodb'
import { buildMongoUri } from './mongodb-uri'

class MongoDBConnection {
  private static instance: MongoDBConnection
  private client: MongoClient | null = null
  private db: Db | null = null

  static getInstance (): MongoDBConnection {
    if (!MongoDBConnection.instance) {
      MongoDBConnection.instance = new MongoDBConnection()
    }
    return MongoDBConnection.instance
  }

  async connect (): Promise<void> {
    try {
      if (this.client) {
        console.log('MongoDB já está conectado')
        return
      }

      this.client = new MongoClient(buildMongoUri())
      await this.client.connect()

      console.log('Conectado ao MongoDB com sucesso')
    } catch (error) {
      console.error('Erro ao conectar ao MongoDB:', error)
      throw error
    }
  }

  /**
   * Garante uma conexão viva antes de usar. Essencial em serverless (Vercel):
   * a função é congelada entre invocações e a topologia do cliente cacheado
   * pode ter sido fechada (MongoTopologyClosedError). Faz um ping; se falhar,
   * descarta o cliente e reconecta. No dev/AWS (processo longo) o ping passa e
   * retorna rápido.
   */
  async ensureConnected (): Promise<void> {
    if (!this.client) {
      await this.connect()
      return
    }
    // Checagem SÍNCRONA (sem ping/rede): só reconecta quando o driver reporta a
    // topologia explicitamente fechada — cenário serverless em que a função foi
    // congelada e o socket morreu. Evita handshakes por request, que sob
    // reconexões frequentes estouram limites de conexão/auth do Atlas.
    const topology = (this.client as unknown as { topology?: { isConnected?: () => boolean } }).topology
    if (topology?.isConnected?.() === false) {
      try {
        await this.client.close()
      } catch { /* já fechada */ }
      this.client = null
      this.db = null
      await this.connect()
    }
  }

  async disconnect (): Promise<void> {
    try {
      if (this.client) {
        await this.client.close()
        this.client = null
        this.db = null
        console.log('Desconectado do MongoDB')
      }
    } catch (error) {
      console.error('Erro ao desconectar do MongoDB:', error)
      throw error
    }
  }

  getClient (): MongoClient {
    if (!this.client) {
      throw new Error('Cliente MongoDB não está conectado')
    }
    return this.client
  }

  getDatabase (env?: string): Db {
    if (!this.client) {
      throw new Error('Cliente MongoDB não está conectado')
    }
    if (env) {
      return this.client.db(env)
    }
    if (!this.db) {
      throw new Error('Banco de dados não está conectado')
    }
    return this.db
  }

  setDatabase (env: string) {
    if (!this.client) {
      throw new Error('Cliente MongoDB não está conectado')
    }
    this.db = this.client.db(env)
  }

  isConnected (): boolean {
    return this.client !== null
  }

  /* c8 ignore start */ // handlers de sinal do processo — não exercitados em teste
  setupGracefulShutdown (): void {
    const shutdownHandler = async (signal: string) => {
      console.log(`\n${signal} recebido. Fechando conexão com MongoDB...`)
      await this.disconnect()
      process.exit(0)
    }

    process.on('SIGINT', () => shutdownHandler('SIGINT'))
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'))
    process.on('SIGUSR2', () => shutdownHandler('SIGUSR2')) // nodemon restart
  }
  /* c8 ignore stop */
}

export default MongoDBConnection
