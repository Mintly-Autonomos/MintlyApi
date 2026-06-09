/**
 * Inicializa o replica set local do MongoDB (rs0).
 * Rode uma única vez após reiniciar o mongod com replication config.
 *
 *   node scripts/init-replica-set.mjs
 */

import { MongoClient } from 'mongodb'

const URI = 'mongodb://127.0.0.1:27017/?directConnection=true'

const client = new MongoClient(URI)

try {
  await client.connect()
  console.log('✅ Conectado ao MongoDB')

  const admin = client.db('admin')

  // Tenta inicializar o replica set
  try {
    const result = await admin.command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: '127.0.0.1:27017' }],
      },
    })
    console.log('✅ Replica set inicializado:', JSON.stringify(result, null, 2))
  } catch (err) {
    // Código 23 = já foi iniciado
    if (err.codeName === 'AlreadyInitialized' || err.code === 23) {
      console.log('ℹ️  Replica set já estava inicializado — sem problema.')
    } else {
      throw err
    }
  }

  // Aguarda o primary ficar disponível
  console.log('⏳ Aguardando primary...')
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const status = await admin.command({ replSetGetStatus: 1 })
      const primary = status.members?.find(m => m.stateStr === 'PRIMARY')
      if (primary) {
        console.log(`✅ Primary disponível: ${primary.name}`)
        break
      }
      process.stdout.write('.')
    } catch { /* ainda inicializando */ }
  }
} catch (err) {
  console.error('❌ Erro:', err.message)
  process.exit(1)
} finally {
  await client.close()
}
