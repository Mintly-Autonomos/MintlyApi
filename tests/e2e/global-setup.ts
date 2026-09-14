import * as dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import { APP_DB } from '../../src/app/environment/env-allowlist'

dotenv.config({ path: '.env.e2e' })

const COLLECTION = 'valid_environments'
const E2E_ENV = 'e2e'

/**
 * O E2E roda contra o MESMO cluster do staging (mesmo cluster id no `.env.e2e`),
 * então lê a mesma allowlist `app.valid_environments` que a API publicada usa em
 * `assertValidEnv` (src/app/environment/env-allowlist.ts).
 *
 * Enquanto a coleção estava vazia a validação era permissiva e `env: e2e` passava.
 * Depois de `db:seed-envs` (staging/production), a allowlist deixou de ser vazia e
 * TODA a suíte E2E passou a tomar 400/APP-0004 — sem uma linha de código do E2E ter
 * mudado. Semear `e2e` junto resolveria, mas deixaria a API de produção aceitando um
 * ambiente de teste para sempre.
 *
 * Então a suíte passa a garantir o próprio pré-requisito: registra `e2e` antes de
 * rodar e o REMOVE no teardown. Se alguém já tiver cadastrado `e2e` de propósito,
 * o teardown não mexe — só limpamos o que nós inserimos.
 */
let inseridoPorNos = false

function client (): MongoClient {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('Defina MONGODB_URI no .env.e2e — copie de .env.e2e.example')
  return new MongoClient(uri)
}

export async function setup (): Promise<void> {
  const conn = client()
  await conn.connect()
  try {
    const col = conn.db(APP_DB).collection<{ name: string }>(COLLECTION)
    const total = await col.countDocuments()

    // Allowlist vazia = validação permissiva: não há o que registrar, e inserir
    // aqui ATIVARIA a proteção para todo mundo que usa o cluster.
    if (total === 0) return

    const res = await col.updateOne({ name: E2E_ENV }, { $setOnInsert: { name: E2E_ENV } }, { upsert: true })
    inseridoPorNos = res.upsertedCount === 1
  } finally {
    await conn.close()
  }
}

export async function teardown (): Promise<void> {
  if (!inseridoPorNos) return
  const conn = client()
  await conn.connect()
  try {
    await conn.db(APP_DB).collection(COLLECTION).deleteOne({ name: E2E_ENV })
  } finally {
    await conn.close()
  }
}
