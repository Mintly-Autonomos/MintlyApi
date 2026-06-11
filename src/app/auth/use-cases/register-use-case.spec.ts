import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { RegisterUseCase } from './register-use-case'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import * as jwtModule from '../../../infrastructure/jwt/jwt-service'

vi.mock('../../../infrastructure/jwt/jwt-service')

const CTX = { env: 'default' }

const VALID_INPUT = {
  person: { name: 'João Silva', phone: '11999990000' },
  email: 'joao@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante do João',
  termsAccepted: true,
}

function makeMongoMock (overrides: { userExists?: boolean } = {}) {
  const ids = { user: new ObjectId(), person: new ObjectId(), restaurant: new ObjectId() }

  const collections: Record<string, any> = {
    users: {
      findOne: vi.fn().mockResolvedValue(overrides.userExists ? { _id: ids.user, email: VALID_INPUT.email } : null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: ids.user }),
      createIndex: vi.fn().mockResolvedValue('email_1'),
    },
    people: { insertOne: vi.fn().mockResolvedValue({ insertedId: ids.person }) },
    restaurants: { insertOne: vi.fn().mockResolvedValue({ insertedId: ids.restaurant }) },
    financial_accounts: { insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }) },
    financial_categories: { insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }) },
    audit_logs: { insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }) },
  }

  const session = {
    withTransaction: vi.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
    endSession: vi.fn().mockResolvedValue(undefined),
  }

  const db = { collection: vi.fn().mockImplementation((name: string) => collections[name]) }

  vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({
    getClient: vi.fn().mockReturnValue({ startSession: vi.fn().mockReturnValue(session) }),
    getDatabase: vi.fn().mockReturnValue(db),
  } as any)

  return { collections, session, db, ids }
}

describe('RegisterUseCase', () => {
  let useCase: RegisterUseCase
  let jwtMock: any

  beforeEach(() => {
    vi.clearAllMocks()
    jwtMock = { generate: vi.fn().mockResolvedValue({ accessToken: 'mock-access', refreshToken: 'mock-refresh' }) }
    vi.spyOn(jwtModule, 'getJwtService').mockReturnValue(jwtMock)
    useCase = new RegisterUseCase()
  })

  describe('cadastro bem-sucedido', () => {
    it('retorna tokens, usuário e restaurante', async () => {
      makeMongoMock()
      const result = await useCase.execute(VALID_INPUT, CTX)
      expect(result.accessToken).toBe('mock-access')
      expect(result.refreshToken).toBe('mock-refresh')
      expect(result.user.email).toBe('joao@restaurante.com')
      expect(result.user.person.name).toBe('João Silva')
      expect(result.restaurant.name).toBe('Restaurante do João')
    })

    it('cria person, restaurant e user', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      expect(collections.people.insertOne).toHaveBeenCalled()
      expect(collections.restaurants.insertOne).toHaveBeenCalled()
      expect(collections.users.insertOne).toHaveBeenCalled()
    })

    it('grava o user com person como extended reference, role owner e status active', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      const userDoc = collections.users.insertOne.mock.calls[0][0]
      expect(userDoc.person).toEqual(expect.objectContaining({ name: 'João Silva' }))
      expect(userDoc.person._id).toBeDefined()
      expect(userDoc.role).toBe('owner')
      expect(userDoc.status).toBe('active')
    })

    it('não armazena a senha em texto puro', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      const userDoc = collections.users.insertOne.mock.calls[0][0]
      expect(userDoc.passwordHash).toBeDefined()
      expect(userDoc.passwordHash).not.toBe('Senha123')
      expect(userDoc.passwordHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/)
    })

    it('cria conta Caixa padrão (cash, active, default)', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      expect(collections.financial_accounts.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Caixa', type: 'cash', status: 'active', isDefault: true }),
        expect.anything(),
      )
    })

    it('cria 6 categorias padrão, todas isSystem (2 revenue + 4 expense)', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      const [docs] = collections.financial_categories.insertMany.mock.calls[0]
      expect(docs).toHaveLength(6)
      expect(docs.every((c: any) => c.isSystem === true)).toBe(true)
      expect(docs.filter((c: any) => c.type === 'revenue')).toHaveLength(2)
      expect(docs.filter((c: any) => c.type === 'expense')).toHaveLength(4)
    })

    it('registra os 4 eventos de auditoria', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      const [docs] = collections.audit_logs.insertMany.mock.calls[0]
      expect(docs.map((a: any) => a.event)).toEqual([
        'account_created', 'restaurant_created', 'terms_accepted', 'onboarding_completed',
      ])
    })

    it('garante o índice único de e-mail', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute(VALID_INPUT, { env: 'idxcheck' })
      expect(collections.users.createIndex).toHaveBeenCalledWith({ email: 1 }, { unique: true })
    })

    it('roteia o banco pelo env do contexto', async () => {
      makeMongoMock()
      await useCase.execute(VALID_INPUT, { env: 'e2e' })
      expect((MongoDBConnection.getInstance() as any).getDatabase).toHaveBeenCalledWith('e2e')
    })

    it('executa tudo numa única transação', async () => {
      const { session } = makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      expect(session.withTransaction).toHaveBeenCalledOnce()
      expect(session.endSession).toHaveBeenCalledOnce()
    })

    it('gera token com claims name, email, role e restaurantId', async () => {
      makeMongoMock()
      await useCase.execute(VALID_INPUT, CTX)
      expect(jwtMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'mintly',
          claims: expect.objectContaining({ name: 'João Silva', email: 'joao@restaurante.com', role: 'owner' }),
        }),
      )
    })
  })

  describe('e-mail duplicado', () => {
    it('lança ConflictError', async () => {
      makeMongoMock({ userExists: true })
      await expect(useCase.execute(VALID_INPUT, CTX)).rejects.toBeInstanceOf(ConflictError)
    })

    it('não cria person nem user', async () => {
      const { collections } = makeMongoMock({ userExists: true })
      await useCase.execute(VALID_INPUT, CTX).catch(() => null)
      expect(collections.people.insertOne).not.toHaveBeenCalled()
      expect(collections.users.insertOne).not.toHaveBeenCalled()
    })
  })

  describe('validações', () => {
    // name check (não instanceof): o schema vem da lib (build CJS), então a classe
    // do erro difere da importada aqui (ESM) — dual package hazard.
    it('lança erro de validação para e-mail inválido', async () => {
      makeMongoMock()
      const err = await useCase.execute({ ...VALID_INPUT, email: 'invalido' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
    })

    it('lança erro de validação para senha fraca', async () => {
      makeMongoMock()
      const err = await useCase.execute({ ...VALID_INPUT, password: 'fraca' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
    })

    it('lança SapphireValidationError quando termsAccepted é false', async () => {
      makeMongoMock()
      await expect(useCase.execute({ ...VALID_INPUT, termsAccepted: false }, CTX)).rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('não toca no Mongo quando o schema é inválido', async () => {
      const { collections } = makeMongoMock()
      await useCase.execute({ ...VALID_INPUT, email: 'x' }, CTX).catch(() => null)
      expect(collections.users.findOne).not.toHaveBeenCalled()
    })
  })
})
