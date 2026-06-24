import { FastifyInstance } from 'fastify'
// ⚠️ AJUSTAR: importe o builder de servidor que os outros .int.spec já usam
// (referência: src/infrastructure/server/build-server.ts).
import { buildServer } from '../../../infrastructure/server/build-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integração HTTP da inativação (PATCH /financial-accounts/:id/inactivate).
 * Cobre o que o teste do use case (sut.execute direto) NÃO cobria: o wiring da rota.
 *
 * ⚠️ AJUSTAR conforme o padrão dos seus .int.spec existentes:
 *  - nome/origem do header de tenant que o buildRequestContext lê (restaurantId + env);
 *  - prefixo das rotas ('/financial-accounts');
 *  - limpeza da collection entre os testes (afterEach) / conexão de teste.
 */

const RESTAURANT_ID = 'rest-int-inactivate'

// ⚠️ AJUSTAR: troque pelos headers reais que o buildRequestContext espera.
const tenantHeaders = {
  'x-restaurant-id': RESTAURANT_ID,
  // 'x-env': 'test',
}

let app: FastifyInstance

// Helper: cria uma conta via API e devolve o _id criado.
async function createAccount (overrides: Record<string, any> = {}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/financial-accounts',
    headers: tenantHeaders,
    payload: {
      restaurantId: RESTAURANT_ID,
      name: `Conta ${Math.random().toString(36).slice(2, 8)}`,
      type: 'cash',
      status: 'active',
      isDefault: false,
      availableBalance: 0,
      predictedBalance: 0,
      ...overrides,
    },
  })
  expect(res.statusCode).toBe(201)
  // ⚠️ AJUSTAR: ajuste o caminho do _id conforme o formato do ResponseBuilder.
  return res.json().data?._id ?? res.json()._id
}

function inactivate (id: string, body?: Record<string, any>) {
  return app.inject({
    method: 'PATCH',
    url: `/financial-accounts/${id}/inactivate`,
    headers: tenantHeaders,
    payload: body ?? {},
  })
}

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

// ⚠️ AJUSTAR: limpar a collection financial_accounts do restaurante entre os testes.
// afterEach(async () => { await clearFinancialAccounts(RESTAURANT_ID) })

describe('PATCH /financial-accounts/:id/inactivate', () => {
  it('inativa uma conta válida (não-padrão, sem saldo, não única) → 200', async () => {
    await createAccount({ name: 'Outra Ativa' }) // garante que não é a única ativa
    const id = await createAccount({ name: 'Alvo' })

    const res = await inactivate(id)

    expect(res.statusCode).toBe(200)
  })

  it('bloqueia inativar a única conta ativa → 409', async () => {
    const onlyActive = await createAccount({ name: 'Unica' })

    const res = await inactivate(onlyActive)

    expect(res.statusCode).toBe(409)
  })

  it('bloqueia inativar conta com saldo disponível ≠ 0 → 409', async () => {
    await createAccount({ name: 'Outra Ativa' })
    const comSaldo = await createAccount({ name: 'Com Saldo', availableBalance: 100 })

    const res = await inactivate(comSaldo)

    expect(res.statusCode).toBe(409)
  })

  it('bloqueia inativar a conta padrão sem informar substituta → 409', async () => {
    await createAccount({ name: 'Outra Ativa' })
    const padrao = await createAccount({ name: 'Padrao', isDefault: true })

    const res = await inactivate(padrao) // sem replacementDefaultId

    expect(res.statusCode).toBe(409)
  })

  it('inativa a conta padrão quando uma substituta válida é informada → 200', async () => {
    const substituta = await createAccount({ name: 'Substituta' })
    const padrao = await createAccount({ name: 'Padrao', isDefault: true })

    const res = await inactivate(padrao, { replacementDefaultId: substituta })

    expect(res.statusCode).toBe(200)
    // (opcional) verificar via GET que 'substituta' agora é isDefault: true
  })
})

