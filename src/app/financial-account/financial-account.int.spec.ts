import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// Importamos a função que cria o servidor Fastify da nossa arquitetura base

import { FastifyInstance } from 'fastify'
import { buildServer } from '../../infrastructure/server/build-server'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { getJwtService } from '../../infrastructure/jwt/jwt-service'
import { FinancialAccountRepository } from './financial-account-repository'

describe('Financial Account (Integration)', () => {
  let app: FastifyInstance
  const fakeRestaurantId = '507f1f77bcf86cd799439011'
  let createdAccountId: string
  let platformAccountId: string
  let testToken: string

  let mongod: MongoMemoryServer // <-- Nossa variável do banco falso
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    process.env.MONGODB_URI = mongod.getUri()
    await MongoDBConnection.getInstance().connect()

    try {
      const jwtService = getJwtService('test')

      // ---> A PEÇA QUE FALTAVA <---
      // Criamos a chave criptográfica do restaurante no nosso banco em memória!
      await jwtService.rotateSigningKey(fakeRestaurantId)

      // Agora geramos o token normalmente
      const tokenResult = await jwtService.generate({
        tenantId: fakeRestaurantId,
        subject: 'admin-user-id',
        body: {
          issuer: 'mintly',
          subject: 'admin-user-id',
          audiences: ['mintly-api'],
          tokenId: 'token-123',
        } as any,
      })

      testToken = tokenResult.accessToken
      console.log('✅ SUCESSO: Token e Chaves gerados!')
    } catch (error) {
      console.error('🚨 ERRO FATAL NA MÁQUINA DE CRACHÁS:', error)
    }

    app = await buildServer()
    await app.ready()

    await new FinancialAccountRepository().createIndexes({ env: 'test', restaurantId: fakeRestaurantId })
  })

  afterAll(async () => {
    await app.close()
    await MongoDBConnection.getInstance().disconnect()

    // 4. Destrói o banco da memória para não travar o seu PC
    if (mongod) {
      await mongod.stop()
    }
  })

  // ---------------------------------------------------------
  // TESTE 1: CRIAR UMA CONTA (Fluxo Feliz)
  // ---------------------------------------------------------
  it('deve criar uma conta financeira com sucesso', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/financial-accounts', // A rota que criámos!
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test', // <-- A PONTE PARA O BANCO DE DADOS CORRETO!
      },
      payload: {
        name: 'Caixa Integração',
        type: 'cash',
        status: 'active',
        // isDefault/saldos NÃO são enviados: o servidor os força (A3) e o schema
        // de insert da lib passará a rejeitá-los (forward-compat com o bump).
        restaurantId: fakeRestaurantId,
        audit: {
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    })
    expect(response.statusCode).toBe(201)

    const body = JSON.parse(response.payload)
    expect(body.payload._id).toBeDefined()
    createdAccountId = body.payload._id
  })

  // ---------------------------------------------------------
  // TESTE 2: LISTAR CONTAS (GET)
  // ---------------------------------------------------------
  it('deve listar as contas financeiras do restaurante', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/financial-accounts',
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test', // <-- A PONTE PARA O BANCO DE DADOS CORRETO!
      },
    })

    expect(response.statusCode).toBe(200)

    const body = JSON.parse(response.payload)
    expect(body.payload.length).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------
  // TESTE 2b: LISTAR CONTAS com isMultipleResponse=true (parâmetro fixo
  // do HttpBaseClient.findAll da mintly-lib — regressão de bug: esse
  // parâmetro vazava pro filtro do Mongo e a listagem via client oficial
  // sempre voltava vazia)
  // ---------------------------------------------------------
  it('deve listar as contas financeiras mesmo com isMultipleResponse=true na query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/financial-accounts?isMultipleResponse=true',
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test',
      },
    })

    expect(response.statusCode).toBe(200)

    const body = JSON.parse(response.payload)
    expect(body.payload.length).toBeGreaterThan(0)
  })

  it('page negativo é clampado (não estoura 500 por skip negativo)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/financial-accounts?page=-1&size=10',
      headers: { 'x-restaurant-id': fakeRestaurantId, authorization: `Bearer ${testToken}`, env: 'test' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('operador Mongo na query ($where) é removido (anti-injeção)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/financial-accounts?$where=sleep(100)',
      headers: { 'x-restaurant-id': fakeRestaurantId, authorization: `Bearer ${testToken}`, env: 'test' },
    })
    // sanitizeFilter descarta a chave $where → lista normalmente, sem executar JS server-side.
    expect(response.statusCode).toBe(200)
  })

  // ---------------------------------------------------------
  // TESTE 3: ATUALIZAÇÃO PROIBIDA (Regra de Negócio)
  // ---------------------------------------------------------
  it('deve bloquear a edição direta do isDefault via PUT', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${createdAccountId}`,
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test', // <-- A PONTE PARA O BANCO DE DADOS CORRETO!
      },
      payload: {
        isDefault: false, // <-- A TENTATIVA PROIBIDA
        type: 'cash',
        restaurantId: fakeRestaurantId,
      },
    })

    // O sistema DEVE cuspir um erro 400 ou 500, a depender de como o CrudController do projeto base apanha o erro
    expect(response.statusCode).not.toBe(200)
  })

  it('deve bloquear a criação de uma conta com nome e tipo duplicados (409 Conflict)', async () => {
    // Tentamos criar exatamente a mesma conta do Teste 1
    const response = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test',
      },
      payload: {
        name: 'Caixa Integração',
        type: 'cash',
        status: 'active',
        restaurantId: fakeRestaurantId,
        audit: { createdAt: new Date(), updatedAt: new Date() },
      },
    })

    // O sistema DEVE barrar com status 409!
    expect(response.statusCode).toBe(409)
  })

  // ---------------------------------------------------------
  // TESTE 4: TIPO IMUTÁVEL E TAXA SÓ EM CONTA PLATFORM (P5)
  // ---------------------------------------------------------
  it('cria uma conta platform (fixture para os testes de P5)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/financial-accounts',
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test',
      },
      payload: {
        name: 'Maquininha Integração',
        type: 'platform',
        feePercent: 3,
        settlementDays: 30,
        status: 'active',
        restaurantId: fakeRestaurantId,
        audit: { createdAt: new Date(), updatedAt: new Date() },
      },
    })

    expect(response.statusCode).toBe(201)

    const body = JSON.parse(response.payload)
    platformAccountId = body.payload._id
  })

  it('PATCH com type é rejeitado — tipo da conta é imutável (P5)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${createdAccountId}`,
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test',
      },
      payload: { type: 'platform' },
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.statusCode).toBeLessThan(500)
  })

  it('PATCH com feePercent em conta não-platform (cash) é rejeitado (P5)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${createdAccountId}`,
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test',
      },
      payload: { feePercent: 5 },
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.statusCode).toBeLessThan(500)
  })

  it('PATCH com feePercent em conta platform é aceito (P5)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${platformAccountId}`,
      headers: {
        'x-restaurant-id': fakeRestaurantId,
        authorization: `Bearer ${testToken}`,
        env: 'test',
      },
      payload: { feePercent: 15 },
    })

    expect(response.statusCode).toBe(200)
  })
})
