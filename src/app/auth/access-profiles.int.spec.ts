import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { buildServer } from '../../infrastructure/server/build-server'
import { setEmailService } from '../../infrastructure/email/email-service'
import { FinancialAccountRepository } from '../financial-account/financial-account-repository'
import { FinancialMovementRepository } from '../financial-movement/financial-movement-repository'
import { toLocalDay } from '../reports/shared/period'

// E.3 do relatório Sweetie Bel: perfis Operação e Gerente, conferidos na API.

let envCounter = 0
const freshEnv = () => `int_perfis_${++envCounter}`
const MEMBER_PASSWORD = 'Func12345'

describe('perfis de funcionário: Operação e Gerente (E.3, integração)', () => {
  let replset: MongoMemoryReplSet
  let app: FastifyInstance
  const invites = new Map<string, string>()

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
    setEmailService({ sendPasswordRecovery: async () => {}, sendMemberInvite: async (to, token) => { invites.set(to, token) } })
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await mongoConnection.disconnect()
    await replset.stop()
  })

  const call = (method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE', url: string, auth: Record<string, string>, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: auth, payload: payload as any })

  /** Dono com conta, categorias (Vendas e Salários, de pessoal) e um salário lançado; funcionário logado. */
  async function setup (profile: 'operations' | 'manager') {
    const env = freshEnv()
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { env },
      payload: { person: { name: 'Dona', phone: '11977777777' }, password: 'Senha123', restaurantName: 'Doceria', termsAccepted: true, email: `dona_${env}@teste.com` },
    })
    const { accessToken, user } = signup.json().payload
    const owner = { env, authorization: `Bearer ${accessToken}` }
    const restaurantId: string = user.restaurantId
    await new FinancialAccountRepository().createIndexes({ env, restaurantId })
    await new FinancialMovementRepository().createIndexes({ env, restaurantId })
    const db = mongoConnection.getDatabase(env)
    const accRes = await call('POST', '/financial-accounts', owner, { name: 'Gaveta', type: 'cash', status: 'active' })
    expect(accRes.statusCode, accRes.body).toBe(201)
    const accountId = accRes.json().payload._id
    const audit = { createdAt: new Date(), updatedAt: new Date() }
    const vendas = String((await db.collection('financial_categories').insertOne({ restaurantId, name: 'Vendas balcão', type: 'revenue', behavior: 'variable', operationalNature: 'operational', status: 'active', isSystem: false, audit })).insertedId)
    const salarios = String((await db.collection('financial_categories').insertOne({ restaurantId, name: 'Salários equipe', type: 'expense', behavior: 'fixed', operationalNature: 'operational', dreGroup: 'labor', status: 'active', isSystem: false, audit })).insertedId)
    const embalagens = String((await db.collection('financial_categories').insertOne({ restaurantId, name: 'Embalagens', type: 'expense', behavior: 'variable', operationalNature: 'operational', dreGroup: 'cmv', status: 'active', isSystem: false, audit })).insertedId)
    const today = toLocalDay(new Date())
    const salario = (await call('POST', '/financial-movements', owner, { direction: 'out', title: 'Salário Bia', grossValue: 2_400, date: today, accountId, categoryId: salarios, paymentMethod: 'pix', status: 'pending' })).json().payload

    const email = `func_${env}@teste.com`
    const memberId = (await call('POST', '/restaurants/me/members', owner, { name: 'Caio', email, profile })).json().payload._id
    await app.inject({ method: 'POST', url: '/auth/invite/accept', headers: { env }, payload: { token: invites.get(email), newPassword: MEMBER_PASSWORD, confirmNewPassword: MEMBER_PASSWORD } })
    const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { env }, payload: { email, password: MEMBER_PASSWORD } })
    expect(login.statusCode).toBe(200)
    const member = { env, authorization: `Bearer ${login.json().payload.accessToken}` }
    return { env, db, owner, member, memberId, accountId, vendas, salarios, embalagens, salario, today }
  }

  const month = () => toLocalDay(new Date()).slice(0, 7)
  const REPORTS = ['/reports/result', '/reports/expenses', '/reports/cash-flow', '/dashboard/overview', '/ai/usage']

  it('Operação não abre relatórios, painel nem IA (403 com o motivo); o dono abre', async () => {
    const s = await setup('operations')
    for (const url of REPORTS) {
      const r = await call('GET', `${url}?month=${month()}`, s.member)
      expect(r.statusCode, url).toBe(403)
      expect(r.json().message).toMatch(/Operação.*relatórios/)
      const dono = await call('GET', `${url}?month=${month()}`, s.owner)
      // O dono nunca leva a recusa do perfil (a IA pode recusar por plano, que é outra regra).
      expect(dono.body, url).not.toMatch(/Seu perfil/)
    }
  })

  it('Operação lê contas, categorias e cardápio, mas não muda nenhum deles', async () => {
    const s = await setup('operations')
    expect((await call('GET', '/financial-accounts', s.member)).statusCode).toBe(200)
    expect((await call('GET', '/menu-items', s.member)).statusCode).toBe(200)
    const writes: Array<[any, string, Record<string, unknown>?]> = [
      ['POST', '/financial-accounts', { name: 'Outra', type: 'cash', status: 'active' }],
      ['PATCH', `/financial-accounts/${s.accountId}`, { name: 'Renomeada' }],
      ['PUT', `/financial-accounts/${s.accountId}/opening-balance`, { amount: 100 }],
      ['POST', '/financial-categories', { name: 'Nova', type: 'expense', behavior: 'fixed' }],
      ['PATCH', `/financial-categories/${s.vendas}`, { name: 'Outra' }],
      ['POST', '/menu-items', { name: 'Bolo', price: 10 }],
      ['POST', '/financial-movements/recompute-balances', { accountId: s.accountId }],
    ]
    for (const [method, url, body] of writes) {
      const r = await call(method, url, s.member, body)
      expect(r.statusCode, `${method} ${url}`).toBe(403)
      expect(r.json().message).toMatch(/não muda cadastros/)
    }
  })

  it('Operação não vê as categorias nem as movimentações de pessoal', async () => {
    const s = await setup('operations')
    const cats = (await call('GET', '/financial-categories?size=100', s.member)).json().payload.map((c: any) => c.name)
    expect(cats).toEqual(expect.arrayContaining(['Vendas balcão', 'Embalagens']))
    expect(cats).not.toContain('Salários equipe')
    const sugestoes = (await call('GET', '/financial-categories/suggestions?direction=out', s.member)).json().payload.map((c: any) => c.name)
    expect(sugestoes).not.toContain('Salários equipe')

    await call('POST', '/financial-movements', s.member, { direction: 'out', title: 'Caixas', grossValue: 30, date: s.today, accountId: s.accountId, categoryId: s.embalagens, paymentMethod: 'pix' })
    const lista = await call('GET', '/financial-movements?size=100', s.member)
    const titulos = lista.json().payload.map((m: any) => m.title)
    expect(titulos).toContain('Caixas')
    expect(titulos).not.toContain('Salário Bia')
    expect(lista.json().pagination?.totalItems ?? titulos.length).toBe(titulos.length)
    // Nem tentando passar o filtro pela query.
    const burla = (await call('GET', '/financial-movements?size=100&excludeCategoryIds=', s.member)).json().payload.map((m: any) => m.title)
    expect(burla).not.toContain('Salário Bia')
    // O dono continua vendo tudo.
    expect((await call('GET', '/financial-movements?size=100', s.owner)).json().payload.map((m: any) => m.title)).toContain('Salário Bia')
  })

  it('Operação lança venda e despesa da operação, mas não salário: nem lançar, nem editar, nem pagar, nem importar', async () => {
    const s = await setup('operations')
    const venda = await call('POST', '/financial-movements', s.member, { direction: 'in', title: 'Venda', grossValue: 80, date: s.today, accountId: s.accountId, categoryId: s.vendas, paymentMethod: 'pix' })
    expect(venda.statusCode).toBe(201)

    const novoSalario = await call('POST', '/financial-movements', s.member, { direction: 'out', title: 'Salário Caio', grossValue: 1_950, date: s.today, accountId: s.accountId, categoryId: s.salarios, paymentMethod: 'pix' })
    expect(novoSalario.statusCode).toBe(403)
    expect(novoSalario.json().message).toMatch(/pessoal/)

    expect((await call('PATCH', `/financial-movements/${s.salario._id}`, s.member, { title: 'Mexido' })).statusCode).toBe(403)
    expect((await call('PATCH', `/financial-movements/${s.salario._id}/status`, s.member, { status: 'settled' })).statusCode).toBe(403)
    // Nem mover uma despesa comum para a categoria de pessoal.
    const caixa = (await call('POST', '/financial-movements', s.member, { direction: 'out', title: 'Caixas', grossValue: 30, date: s.today, accountId: s.accountId, categoryId: s.embalagens, paymentMethod: 'pix' })).json().payload
    expect((await call('PATCH', `/financial-movements/${caixa._id}`, s.member, { categoryId: s.salarios })).statusCode).toBe(403)

    const imp = await call('POST', '/financial-movements/import', s.member, {
      idempotencyKey: `perfil-${s.env}`,
      rows: [{ row: 1, direction: 'out', title: 'Salário importado', grossValue: 100, date: s.today, accountId: s.accountId, categoryId: s.salarios, paymentMethod: 'pix' }],
    })
    expect(imp.json().payload.created).toBe(0)
    expect(imp.json().payload.results[0].error.message).toMatch(/pessoal/)

    const doc = await s.db.collection('financial_movements').findOne({ _id: new ObjectId(s.salario._id) })
    expect(doc?.title).toBe('Salário Bia')
    expect(doc?.status).toBe('pending')
  })

  it('Gerente vê relatórios, muda cadastros e vê pessoal; só o que é do dono continua fechado', async () => {
    const s = await setup('manager')
    expect((await call('GET', `/reports/result?month=${month()}`, s.member)).statusCode).toBe(200)
    expect((await call('POST', '/financial-accounts', s.member, { name: 'Banco', type: 'bank', status: 'active' })).statusCode).toBe(201)
    expect((await call('GET', '/financial-movements?size=100', s.member)).json().payload.map((m: any) => m.title)).toContain('Salário Bia')
    expect((await call('GET', '/restaurants/me/members', s.member)).statusCode).toBe(403)
  })

  it('trocar o perfil vale no pedido seguinte, com o mesmo token', async () => {
    const s = await setup('manager')
    expect((await call('GET', `/reports/result?month=${month()}`, s.member)).statusCode).toBe(200)
    expect((await call('PATCH', `/restaurants/me/members/${s.memberId}`, s.owner, { profile: 'operations' })).statusCode).toBe(200)
    expect((await call('GET', `/reports/result?month=${month()}`, s.member)).statusCode).toBe(403)
    expect((await call('GET', '/users/me', s.member)).json().payload.memberProfile).toBe('operations')
  })

  it('funcionário antigo, sem perfil gravado, continua vendo tudo (Gerente)', async () => {
    const s = await setup('operations')
    await s.db.collection('users').updateOne({ _id: new ObjectId(s.memberId) }, { $unset: { memberProfile: '' } })
    expect((await call('GET', `/reports/result?month=${month()}`, s.member)).statusCode).toBe(200)
    const list = (await call('GET', '/restaurants/me/members', s.owner)).json().payload
    expect(list[0].profile).toBe('manager')
  })
})
