// Verificação manual de todas as rotas do MintlyApi contra o servidor real.
// Sobe o server como processo filho (capturando o token de recovery impresso
// pelo ConsoleEmailService), exercita sucesso+erro de cada rota, inspeciona as
// collections no Mongo e dropa o banco de teste no final.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { MongoClient } from 'mongodb'

const ENV = 'manualtest_routes'
const PORT = 3210
const BASE = `http://localhost:${PORT}`
const MONGODB_URI = readFileSync('.env', 'utf8').match(/MONGODB_URI=(.+)/)[1].trim()

// ── servidor como processo filho ────────────────────────────────────────────
const recoveryTokens = []
const serverLines = []
const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'src/server.ts'], {
  env: { ...process.env, PORT: String(PORT), RESEND_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8')
  stream.on('data', chunk => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue
      serverLines.push(line)
      const m = line.match(/\[EMAIL-DEV\] Token: ([a-f0-9]{64})/)
      if (m) recoveryTokens.push(m[1])
    }
  })
}
const killServer = () => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']) } catch {} }

// ── helpers ──────────────────────────────────────────────────────────────────
const results = []
async function req (method, path, { body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { env: ENV, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let parsed = null
  const text = await res.text()
  if (!raw) { try { parsed = JSON.parse(text) } catch { parsed = text } }
  return { status: res.status, body: raw ? text : parsed }
}
function check (name, expected, actual, note = '') {
  const ok = expected === actual
  results.push({ ok, name, expected, actual, note })
  console.log(`${ok ? 'OK  ' : 'FAIL'} [esperado ${expected} | obtido ${actual}] ${name}${note ? ' — ' + note : ''}`)
}
function checkTrue (name, cond, note = '') {
  results.push({ ok: !!cond, name, expected: true, actual: !!cond, note })
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`)
}
const waitFor = async (fn, ms = 30000) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn().catch(() => false)) return true
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

const signupBody = (email) => ({
  person: { name: 'Dono Teste', phone: '11900000000' },
  email,
  password: 'Senha123',
  restaurantName: 'Restaurante Teste',
  termsAccepted: true,
})
const personBody = (name) => ({
  name,
  phone: '11911111111',
  audit: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
})

const mongo = new MongoClient(MONGODB_URI)

try {
  // ── boot ──
  const up = await waitFor(async () => (await fetch(`${BASE}/health`)).ok, 60000)
  if (!up) throw new Error('Servidor não subiu em 60s.\n' + serverLines.join('\n'))
  await mongo.connect()
  const db = mongo.db(ENV)
  await db.dropDatabase() // garante estado limpo de execuções anteriores

  console.log('\n══ SYSTEM ══')
  check('GET /health → 200', 200, (await req('GET', '/health')).status)
  const health = await req('GET', '/health')
  checkTrue('GET /health body {status:"ok"}', health.body?.status === 'ok')
  check('GET /documentation → 200 (swagger ui)', 200, (await req('GET', '/documentation', { raw: true })).status)
  check('GET /rota-inexistente → 404', 404, (await req('GET', '/rota-inexistente')).status)

  console.log('\n══ AUTH / SIGNUP ══')
  const s1 = await req('POST', '/auth/signup', { body: signupBody('dono@mintly.test') })
  check('signup válido → 201', 201, s1.status)
  checkTrue('signup devolve accessToken/refreshToken/user/restaurant', !!(s1.body?.payload?.accessToken && s1.body?.payload?.refreshToken && s1.body?.payload?.user && s1.body?.payload?.restaurant))
  checkTrue('signup não vaza passwordHash', s1.body?.payload?.user?.passwordHash === undefined)
  const dup = await req('POST', '/auth/signup', { body: signupBody('dono@mintly.test') })
  check('signup e-mail duplicado → 409', 409, dup.status, `code=${dup.body?.code}`)
  const weak = await req('POST', '/auth/signup', { body: { ...signupBody('x@mintly.test'), password: 'fraca' } })
  check('signup senha fraca → 400', 400, weak.status, `code=${weak.body?.code}`)
  const noEmail = { ...signupBody('y@mintly.test') }; delete noEmail.email
  check('signup sem email → 400', 400, (await req('POST', '/auth/signup', { body: noEmail })).status)
  const noBody = await req('POST', '/auth/signup', { body: {} })
  check('signup body vazio → 400', 400, noBody.status)

  console.log('\n══ AUTH / LOGIN ══')
  const l1 = await req('POST', '/auth/login', { body: { email: 'dono@mintly.test', password: 'Senha123' } })
  check('login válido → 200', 200, l1.status)
  const session = l1.body?.payload ?? {}
  const wrongPass = await req('POST', '/auth/login', { body: { email: 'dono@mintly.test', password: 'Errada123' } })
  check('login senha errada → 401', 401, wrongPass.status, `code=${wrongPass.body?.code}`)
  const noUser = await req('POST', '/auth/login', { body: { email: 'naoexiste@mintly.test', password: 'Senha123' } })
  check('login e-mail inexistente → 401', 401, noUser.status)
  checkTrue('mensagem idêntica (senha errada vs e-mail inexistente)', wrongPass.body?.message === noUser.body?.message, `"${wrongPass.body?.message}"`)
  const emptyLogin = await req('POST', '/auth/login', { body: {} })
  check('login body vazio → 401 (sem 500)', 401, emptyLogin.status)

  // lockout com usuário dedicado
  await req('POST', '/auth/signup', { body: signupBody('lock@mintly.test') })
  let last
  for (let i = 0; i < 5; i++) {
    last = await req('POST', '/auth/login', { body: { email: 'lock@mintly.test', password: 'Errada123' } })
  }
  check('5ª tentativa errada ainda → 401', 401, last.status)
  const blocked = await req('POST', '/auth/login', { body: { email: 'lock@mintly.test', password: 'Errada123' } })
  check('6ª tentativa → 429 (lockout)', 429, blocked.status, `code=${blocked.body?.code} msg="${blocked.body?.message}"`)
  const blockedRight = await req('POST', '/auth/login', { body: { email: 'lock@mintly.test', password: 'Senha123' } })
  check('senha CORRETA durante lockout → 429', 429, blockedRight.status)
  const lockUser = await db.collection('users').findOne({ email: 'lock@mintly.test' })
  checkTrue('users.loginAttempts == 5 e blockedUntil setado no banco', lockUser?.loginAttempts === 5 && !!lockUser?.blockedUntil)

  // conta inativa (status alterado direto no banco)
  await req('POST', '/auth/signup', { body: signupBody('inativo@mintly.test') })
  await db.collection('users').updateOne({ email: 'inativo@mintly.test' }, { $set: { status: 'inactive' } })
  const inactiveWrong = await req('POST', '/auth/login', { body: { email: 'inativo@mintly.test', password: 'Errada123' } })
  check('conta inativa + senha ERRADA → 401 genérico (anti-enumeração)', 401, inactiveWrong.status)
  const inactiveRight = await req('POST', '/auth/login', { body: { email: 'inativo@mintly.test', password: 'Senha123' } })
  check('conta inativa + senha CORRETA → 403', 403, inactiveRight.status, `code=${inactiveRight.body?.code}`)

  console.log('\n══ AUTH / REFRESH ══')
  const r1 = await req('POST', '/auth/refresh', { body: { refreshToken: session.refreshToken } })
  check('refresh válido → 200', 200, r1.status)
  const session2 = r1.body?.payload ?? {}
  checkTrue('refresh devolve par novo de tokens', !!(session2.accessToken && session2.refreshToken && session2.refreshToken !== session.refreshToken))
  check('refresh token inválido → 401', 401, (await req('POST', '/auth/refresh', { body: { refreshToken: 'lixo' } })).status)
  const reuseOld = await req('POST', '/auth/refresh', { body: { refreshToken: session.refreshToken } })
  check('reuso do refresh já rotacionado → 401', 401, reuseOld.status)

  console.log('\n══ AUTH / RECUPERAÇÃO DE SENHA ══')
  await req('POST', '/auth/signup', { body: signupBody('recupera@mintly.test') })
  const lRec = await req('POST', '/auth/login', { body: { email: 'recupera@mintly.test', password: 'Senha123' } })
  const recSession = lRec.body?.payload ?? {}
  const fp = await req('POST', '/auth/forgot-password', { body: { email: 'recupera@mintly.test' } })
  check('forgot-password e-mail existente → 202', 202, fp.status, `msg="${fp.body?.payload?.message}"`)
  const gotToken = await waitFor(async () => recoveryTokens.length >= 1, 10000)
  checkTrue('token de recovery capturado no console do servidor', gotToken)
  const rawToken = recoveryTokens[recoveryTokens.length - 1]

  const tokenDoc = await db.collection('password_reset_tokens').findOne({})
  checkTrue('banco guarda sha256 do token (≠ token em claro)', tokenDoc?.token === createHash('sha256').update(rawToken ?? '').digest('hex') && tokenDoc?.token !== rawToken)
  checkTrue('expiresAt persistido como Date', tokenDoc?.expiresAt instanceof Date)
  const ttlIdx = await db.collection('password_reset_tokens').indexes()
  checkTrue('índice TTL presente em password_reset_tokens', ttlIdx.some(ix => ix.expireAfterSeconds !== undefined))

  const before = recoveryTokens.length
  check('forgot-password e-mail inexistente → 202 (não revela)', 202, (await req('POST', '/auth/forgot-password', { body: { email: 'fantasma@mintly.test' } })).status)
  await new Promise(r => setTimeout(r, 800))
  checkTrue('nenhum e-mail enviado para inexistente', recoveryTokens.length === before)
  check('forgot-password e-mail malformado → 400', 400, (await req('POST', '/auth/forgot-password', { body: { email: 'nao-e-email' } })).status)

  const mismatch = await req('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'NovaSenha1', confirmNewPassword: 'Diferente1' } })
  check('reset senhas divergentes → 400', 400, mismatch.status)
  check('reset token inválido → 401', 401, (await req('POST', '/auth/reset-password', { body: { token: 'invalido', newPassword: 'NovaSenha1', confirmNewPassword: 'NovaSenha1' } })).status)
  check('reset senha fraca → 400', 400, (await req('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'fraca', confirmNewPassword: 'fraca' } })).status)
  const resetOk = await req('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'NovaSenha1', confirmNewPassword: 'NovaSenha1' } })
  check('reset válido → 200', 200, resetOk.status, `msg="${resetOk.body?.payload?.message}"`)
  check('reuso do MESMO token → 401 (uso único)', 401, (await req('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'OutraSenha1', confirmNewPassword: 'OutraSenha1' } })).status)
  check('login com senha ANTIGA → 401', 401, (await req('POST', '/auth/login', { body: { email: 'recupera@mintly.test', password: 'Senha123' } })).status)
  check('login com senha NOVA → 200', 200, (await req('POST', '/auth/login', { body: { email: 'recupera@mintly.test', password: 'NovaSenha1' } })).status)
  check('refresh emitido ANTES do reset → 401 (sessões revogadas)', 401, (await req('POST', '/auth/refresh', { body: { refreshToken: recSession.refreshToken } })).status)

  console.log('\n══ AUTH / LOGOUT ══')
  check('logout sem Bearer → 401', 401, (await req('POST', '/auth/logout', { body: { refreshToken: session2.refreshToken } })).status)
  check('logout Bearer inválido → 401', 401, (await req('POST', '/auth/logout', { body: { refreshToken: session2.refreshToken }, headers: { authorization: 'Bearer lixo' } })).status)
  const lo = await req('POST', '/auth/logout', { body: { refreshToken: session2.refreshToken }, headers: { authorization: `Bearer ${session2.accessToken}` } })
  check('logout autenticado → 204', 204, lo.status)
  check('refresh com token deslogado → 401', 401, (await req('POST', '/auth/refresh', { body: { refreshToken: session2.refreshToken } })).status)

  console.log('\n══ PEOPLE (CRUD protegido) ══')
  const l2 = await req('POST', '/auth/login', { body: { email: 'dono@mintly.test', password: 'Senha123' } })
  const bearer = { authorization: `Bearer ${l2.body.payload.accessToken}` }
  check('GET /people sem token → 401', 401, (await req('GET', '/people')).status)
  const pCreate = await req('POST', '/people', { body: personBody('Cliente Um'), headers: bearer })
  check('POST /people válido → 200', 200, pCreate.status)
  const personId = pCreate.body?.payload?._id
  checkTrue('POST devolve _id', !!personId)
  check('POST /people body inválido → 400', 400, (await req('POST', '/people', { body: { name: 'Só nome' }, headers: bearer })).status)
  const pList = await req('GET', '/people', { headers: bearer })
  check('GET /people (lista paginada) → 200', 200, pList.status, `itens=${pList.body?.payload?.length} pagination=${!!pList.body?.pagination}`)
  const pMulti = await req('GET', '/people?isMultipleResponse=true', { headers: bearer })
  check('GET /people?isMultipleResponse=true → 200', 200, pMulti.status)
  const pById = await req('GET', `/people/${personId}`, { headers: bearer })
  check('GET /people/:id → 200', 200, pById.status)
  check('GET /people/:id inexistente (ObjectId válido) → 404', 404, (await req('GET', '/people/aaaaaaaaaaaaaaaaaaaaaaaa', { headers: bearer })).status)
  const pBadId = await req('GET', '/people/id-malformado', { headers: bearer })
  check('GET /people/:id malformado → ? (probe)', pBadId.status, pBadId.status, `obtido ${pBadId.status} code=${pBadId.body?.code} (registrado como observação)`)
  const pPatch = await req('PATCH', `/people/${personId}`, { body: { name: 'Cliente Renomeado' }, headers: bearer })
  check('PATCH /people/:id → 200', 200, pPatch.status, `name=${pPatch.body?.payload?.name}`)
  check('PATCH body inválido (phone numérico) → 400', 400, (await req('PATCH', `/people/${personId}`, { body: { phone: 123 }, headers: bearer })).status)
  check('DELETE /people/:id → 204', 204, (await req('DELETE', `/people/${personId}`, { headers: bearer })).status)
  check('GET após DELETE → 404', 404, (await req('GET', `/people/${personId}`, { headers: bearer })).status)

  console.log('\n══ COLLECTIONS NO MONGO (banco ' + ENV + ') ══')
  for (const c of (await db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const count = await db.collection(c.name).countDocuments()
    console.log(`  ${c.name}: ${count} docs`)
  }
  const auditCounts = await db.collection('audit_logs').aggregate([{ $group: { _id: '$event', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray()
  console.log('  audit_logs por evento: ' + auditCounts.map(a => `${a._id}=${a.n}`).join(', '))
  for (const ev of ['login', 'login_failed', 'logout', 'account_temporarily_blocked', 'password_recovery_requested', 'password_reset', 'account_created', 'onboarding_completed']) {
    checkTrue(`auditoria contém evento ${ev}`, auditCounts.some(a => a._id === ev))
  }
  const sampleAudit = await db.collection('audit_logs').findOne({ event: 'logout' })
  checkTrue('auditoria de logout tem restaurantId', !!sampleAudit?.restaurantId)
  const userDoc = await db.collection('users').findOne({ email: 'dono@mintly.test' })
  checkTrue('users tem passwordHash salt:hash e email único', /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(userDoc?.passwordHash ?? ''))
  const emailIdx = await db.collection('users').indexes()
  checkTrue('índice único em users.email', emailIdx.some(ix => ix.key?.email === 1 && ix.unique))

  console.log('\n══ RESUMO ══')
  const fails = results.filter(r => !r.ok)
  console.log(`${results.length - fails.length}/${results.length} verificações OK`)
  if (fails.length) {
    console.log('FALHAS:')
    for (const f of fails) console.log(`  - ${f.name} (esperado ${f.expected}, obtido ${f.actual}) ${f.note}`)
  }

  console.log('\n══ LIMPEZA ══')
  await db.dropDatabase()
  const dbs = (await mongo.db().admin().listDatabases()).databases.map(d => d.name)
  console.log(dbs.includes(ENV) ? `FALHA: banco ${ENV} ainda existe!` : `Banco ${ENV} dropado. Bancos restantes no cluster: ${dbs.join(', ')}`)

  process.exitCode = fails.length ? 1 : 0
} catch (err) {
  console.error('ERRO NO SCRIPT:', err)
  console.error('Últimas linhas do servidor:\n' + serverLines.slice(-20).join('\n'))
  process.exitCode = 1
} finally {
  await mongo.close().catch(() => {})
  killServer()
}
