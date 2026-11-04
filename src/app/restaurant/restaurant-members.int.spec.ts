import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { MAX_MEMBERS } from './members/member.use-cases'

let envCounter = 0
const freshEnv = () => `int_members_${++envCounter}`
const PASSWORD = 'Senha123'
const MEMBER_PASSWORD = 'Func12345'

describe('funcionários, trava de dono e pedido de exclusão (Integration)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  async function signup (env: string, tag = 'a') {
    const email = `dono_${tag}_${env}@teste.com`
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: `Dono ${tag}`, phone: '11977777777' }, password: PASSWORD, restaurantName: `Cantina ${tag}`, termsAccepted: true, email },
    })
    expect(res.statusCode).toBe(201)
    const { accessToken, user } = res.json().payload
    return { env, email, auth: { env, authorization: `Bearer ${accessToken}` }, restaurantId: user.restaurantId as string, ownerId: user._id as string }
  }

  const call = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, auth: Record<string, string>, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: auth, payload })
  const login = (env: string, email: string, password: string) =>
    app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password } })
  const refresh = (env: string, refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', headers: { env }, payload: { refreshToken } })

  /** Dono + um funcionário já criado e logado. */
  async function withMember (env = freshEnv()) {
    const owner = await signup(env)
    const memberEmail = `func_${env}@teste.com`
    const created = await call('POST', '/restaurants/me/members', owner.auth, { name: 'Ana Garçom', email: memberEmail, password: MEMBER_PASSWORD })
    expect(created.statusCode).toBe(201)
    const logged = await login(env, memberEmail, MEMBER_PASSWORD)
    expect(logged.statusCode).toBe(200)
    const { accessToken, refreshToken } = logged.json().payload
    return {
      owner,
      member: { id: created.json().payload._id as string, email: memberEmail, auth: { env, authorization: `Bearer ${accessToken}` }, refreshToken: refreshToken as string },
    }
  }

  describe('criar e listar funcionários', () => {
    it('o dono cria o login do funcionário, que entra com papel member no MESMO restaurante', async () => {
      const env = freshEnv()
      const owner = await signup(env)
      const email = `func_${env}@teste.com`
      const res = await call('POST', '/restaurants/me/members', owner.auth, { name: '  Ana Garçom ', email: email.toUpperCase(), password: MEMBER_PASSWORD })
      expect(res.statusCode).toBe(201)
      expect(res.json().payload).toMatchObject({ name: 'Ana Garçom', email, status: 'active' })
      expect(JSON.stringify(res.json())).not.toContain('passwordHash')

      const logged = await login(env, email, MEMBER_PASSWORD)
      expect(logged.statusCode).toBe(200)
      expect(logged.json().payload.user).toMatchObject({ role: 'member', restaurantId: owner.restaurantId })
    })

    it('a lista traz só os funcionários do restaurante (nunca o dono nem os de outro restaurante)', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      await call('POST', '/restaurants/me/members', a.auth, { name: 'Ana', email: `ana_${env}@teste.com`, password: MEMBER_PASSWORD })
      await call('POST', '/restaurants/me/members', b.auth, { name: 'Bia', email: `bia_${env}@teste.com`, password: MEMBER_PASSWORD })

      const list = (await call('GET', '/restaurants/me/members', a.auth)).json().payload
      expect(list.map((m: { name: string }) => m.name)).toEqual(['Ana'])
      expect(JSON.stringify(list)).not.toContain('passwordHash')
    })

    it('e-mail já usado (por funcionário ou por outro dono): 409', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      const first = { name: 'Ana', email: `ana_${env}@teste.com`, password: MEMBER_PASSWORD }
      expect((await call('POST', '/restaurants/me/members', a.auth, first)).statusCode).toBe(201)
      expect((await call('POST', '/restaurants/me/members', a.auth, first)).statusCode).toBe(409)
      expect((await call('POST', '/restaurants/me/members', a.auth, { ...first, email: b.email })).statusCode).toBe(409)
    })

    it('senha fraca, e-mail inválido, nome curto e campos extras (papel, restaurante): 400', async () => {
      const { auth } = await signup(freshEnv())
      const ok = { name: 'Ana', email: 'ana@teste.com', password: MEMBER_PASSWORD }
      expect((await call('POST', '/restaurants/me/members', auth, { ...ok, password: 'fraca' })).statusCode).toBe(400)
      expect((await call('POST', '/restaurants/me/members', auth, { ...ok, email: 'ana' })).statusCode).toBe(400)
      expect((await call('POST', '/restaurants/me/members', auth, { ...ok, name: 'A' })).statusCode).toBe(400)
      expect((await call('POST', '/restaurants/me/members', auth, { ...ok, role: 'owner' })).statusCode).toBe(400)
      expect((await call('POST', '/restaurants/me/members', auth, { ...ok, restaurantId: 'outro' })).statusCode).toBe(400)
    })

    it(`limite de ${MAX_MEMBERS} funcionários por restaurante`, async () => {
      const env = freshEnv()
      const { auth } = await signup(env)
      for (let i = 0; i < MAX_MEMBERS; i++) {
        const res = await call('POST', '/restaurants/me/members', auth, { name: `Func ${i}`, email: `f${i}_${env}@teste.com`, password: MEMBER_PASSWORD })
        expect(res.statusCode).toBe(201)
      }
      const extra = await call('POST', '/restaurants/me/members', auth, { name: 'Um a mais', email: `extra_${env}@teste.com`, password: MEMBER_PASSWORD })
      expect(extra.statusCode).toBe(400)
    })
  })

  describe('funcionário não gerencia o restaurante', () => {
    it('não renomeia o restaurante nem muda o regime (PATCH /restaurants/me): 403; o dono continua podendo', async () => {
      const { owner, member } = await withMember()
      expect((await call('PATCH', '/restaurants/me', member.auth, { name: 'Invadido' })).statusCode).toBe(403)
      expect((await call('PATCH', '/restaurants/me', member.auth, { taxRegime: 'mei' })).statusCode).toBe(403)

      const ok = await call('PATCH', '/restaurants/me', owner.auth, { name: 'Cantina Nova' })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().payload.name).toBe('Cantina Nova')
    })

    it('não lista, cria nem altera funcionários: 403', async () => {
      const { member } = await withMember()
      expect((await call('GET', '/restaurants/me/members', member.auth)).statusCode).toBe(403)
      expect((await call('POST', '/restaurants/me/members', member.auth, { name: 'Outro', email: 'outro@teste.com', password: MEMBER_PASSWORD })).statusCode).toBe(403)
      expect((await call('PATCH', `/restaurants/me/members/${member.id}`, member.auth, { status: 'inactive' })).statusCode).toBe(403)
    })

    it('não pede nem cancela a exclusão do restaurante: 403', async () => {
      const { member } = await withMember()
      expect((await call('POST', '/restaurants/me/deletion-request', member.auth, { password: MEMBER_PASSWORD })).statusCode).toBe(403)
      expect((await call('DELETE', '/restaurants/me/deletion-request', member.auth)).statusCode).toBe(403)
    })

    it('mas lê os próprios dados e o restaurante, e troca a própria senha', async () => {
      const { member } = await withMember()
      expect((await call('GET', '/users/me', member.auth)).json().payload).toMatchObject({ name: 'Ana Garçom', role: 'member' })
      expect((await call('GET', '/restaurants/me', member.auth)).statusCode).toBe(200)
      const change = await call('POST', '/users/me/password', member.auth, { currentPassword: MEMBER_PASSWORD, newPassword: 'OutraSenha99' })
      expect(change.statusCode).toBe(200)
    })
  })

  describe('PATCH /restaurants/me/members/:id', () => {
    it('inativar: o funcionário não entra mais e a sessão dele não renova; reativar devolve o acesso', async () => {
      const { owner, member } = await withMember()
      const off = await call('PATCH', `/restaurants/me/members/${member.id}`, owner.auth, { status: 'inactive' })
      expect(off.statusCode).toBe(200)
      expect(off.json().payload.status).toBe('inactive')

      expect((await login(owner.env, member.email, MEMBER_PASSWORD)).statusCode).toBe(403)
      expect((await refresh(owner.env, member.refreshToken)).statusCode).toBe(401)

      const on = await call('PATCH', `/restaurants/me/members/${member.id}`, owner.auth, { status: 'active' })
      expect(on.json().payload.status).toBe('active')
      expect((await login(owner.env, member.email, MEMBER_PASSWORD)).statusCode).toBe(200)
    })

    it('definir senha nova: a antiga deixa de valer e as sessões caem', async () => {
      const { owner, member } = await withMember()
      const res = await call('PATCH', `/restaurants/me/members/${member.id}`, owner.auth, { password: 'SenhaNova77' })
      expect(res.statusCode).toBe(200)
      expect((await login(owner.env, member.email, MEMBER_PASSWORD)).statusCode).toBe(401)
      expect((await login(owner.env, member.email, 'SenhaNova77')).statusCode).toBe(200)
      expect((await refresh(owner.env, member.refreshToken)).statusCode).toBe(401)
    })

    it('funcionário de outro restaurante, o dono e id inválido não existem aqui: 404', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      const bMember = (await call('POST', '/restaurants/me/members', b.auth, { name: 'Bia', email: `bia_${env}@teste.com`, password: MEMBER_PASSWORD })).json().payload

      expect((await call('PATCH', `/restaurants/me/members/${bMember._id}`, a.auth, { status: 'inactive' })).statusCode).toBe(404)
      expect((await call('PATCH', `/restaurants/me/members/${a.ownerId}`, a.auth, { status: 'inactive' })).statusCode).toBe(404)
      expect((await call('PATCH', '/restaurants/me/members/nao-e-um-id', a.auth, { status: 'inactive' })).statusCode).toBe(404)

      // E o funcionário da Bia continua ativo.
      expect((await login(env, bMember.email, MEMBER_PASSWORD)).statusCode).toBe(200)
    })

    it('status que o dono não define (blocked), senha fraca e campos extras: 400', async () => {
      const { owner, member } = await withMember()
      const url = `/restaurants/me/members/${member.id}`
      expect((await call('PATCH', url, owner.auth, { status: 'blocked' })).statusCode).toBe(400)
      expect((await call('PATCH', url, owner.auth, { password: 'fraca' })).statusCode).toBe(400)
      expect((await call('PATCH', url, owner.auth, { role: 'owner' })).statusCode).toBe(400)
      expect((await call('PATCH', url, owner.auth, { email: 'novo@teste.com' })).statusCode).toBe(400)
    })

    it('registra criação e alteração na auditoria', async () => {
      const { owner, member } = await withMember()
      await call('PATCH', `/restaurants/me/members/${member.id}`, owner.auth, { status: 'inactive' })
      const events = (await mongoConnection.getDatabase(owner.env).collection('audit_logs').find({}).toArray()).map((e) => e.event)
      expect(events).toContain('member_created')
      expect(events).toContain('member_updated')
    })
  })

  describe('pedido de exclusão do restaurante', () => {
    it('com a senha do dono grava o pedido (nada é apagado) e o restaurante passa a mostrá-lo', async () => {
      const env = freshEnv()
      const { auth, restaurantId } = await signup(env)
      const res = await call('POST', '/restaurants/me/deletion-request', auth, { password: PASSWORD, reason: 'Fechei o restaurante' })
      expect(res.statusCode).toBe(200)
      const requestedAt = res.json().payload.deletionRequestedAt
      expect(requestedAt).toBeTruthy()

      const me = (await call('GET', '/restaurants/me', auth)).json().payload.restaurant
      expect(me.deletionRequestedAt).toBe(requestedAt)
      expect(me.name).toBe('Cantina a')

      // O motivo vai só para a auditoria, não para o restaurante (que o funcionário também lê).
      expect(JSON.stringify(me)).not.toContain('Fechei o restaurante')
      const audit = await mongoConnection.getDatabase(env).collection('audit_logs').findOne({ event: 'deletion_requested' })
      expect(audit?.data).toMatchObject({ reason: 'Fechei o restaurante' })
      expect(audit?.restaurantId).toBe(restaurantId)
    })

    it('senha errada: 403 e nada é gravado', async () => {
      const { auth } = await signup(freshEnv())
      expect((await call('POST', '/restaurants/me/deletion-request', auth, { password: 'Errada123' })).statusCode).toBe(403)
      expect((await call('GET', '/restaurants/me', auth)).json().payload.restaurant.deletionRequestedAt).toBeUndefined()
    })

    it('sem senha ou com motivo grande demais: 400', async () => {
      const { auth } = await signup(freshEnv())
      expect((await call('POST', '/restaurants/me/deletion-request', auth, {})).statusCode).toBe(400)
      expect((await call('POST', '/restaurants/me/deletion-request', auth, { password: PASSWORD, reason: 'a'.repeat(501) })).statusCode).toBe(400)
    })

    it('pedir de novo não muda a data do primeiro pedido', async () => {
      const { auth } = await signup(freshEnv())
      const first = (await call('POST', '/restaurants/me/deletion-request', auth, { password: PASSWORD })).json().payload.deletionRequestedAt
      const second = (await call('POST', '/restaurants/me/deletion-request', auth, { password: PASSWORD })).json().payload.deletionRequestedAt
      expect(second).toBe(first)
    })

    it('cancelar desfaz o pedido; cancelar sem pedido não dá erro', async () => {
      const { auth } = await signup(freshEnv())
      await call('POST', '/restaurants/me/deletion-request', auth, { password: PASSWORD })
      const cancel = await call('DELETE', '/restaurants/me/deletion-request', auth)
      expect(cancel.statusCode).toBe(200)
      expect(cancel.json().payload.deletionRequestedAt).toBeNull()
      expect((await call('GET', '/restaurants/me', auth)).json().payload.restaurant.deletionRequestedAt).toBeUndefined()

      expect((await call('DELETE', '/restaurants/me/deletion-request', auth)).statusCode).toBe(200)
    })

    it('o pedido de um restaurante não aparece em outro', async () => {
      const env = freshEnv()
      const a = await signup(env, 'a')
      const b = await signup(env, 'b')
      await call('POST', '/restaurants/me/deletion-request', a.auth, { password: PASSWORD })
      expect((await call('GET', '/restaurants/me', b.auth)).json().payload.restaurant.deletionRequestedAt).toBeUndefined()
    })
  })
})
