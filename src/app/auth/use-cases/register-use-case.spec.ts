import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { RegisterUseCase } from './register-use-case'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import * as jwtModule from '../../../infrastructure/jwt/jwt-service'

vi.mock('../../../infrastructure/jwt/jwt-service')

// ─── helpers ─────────────────────────────────────────────────────────────────

const VALID_INPUT = {
  name: 'João Silva',
  email: 'joao@restaurante.com',
  password: 'Senha123',
  confirmPassword: 'Senha123',
  restaurantName: 'Restaurante do João',
  acceptedTerms: true,
  acceptedPrivacy: true,
}

const MOCK_TOKENS = {
  accessToken: 'mock-access',
  refreshToken: 'mock-refresh',
  accessTokenId: 'atid',
  accessTokenExpiresAt: new Date(),
  refreshTokenId: 'rtid',
  refreshTokenExpiresAt: new Date(),
  tenantId: 'mintly',
  subject: '000000000000000000000001',
  keyId: 'kid',
}

function makeMongoMock (overrides: { userExists?: boolean } = {}) {
  const userId = new ObjectId()
  const restaurantId = new ObjectId()

  const collections: Record<string, any> = {
    users: {
      findOne: vi.fn().mockResolvedValue(overrides.userExists ? { _id: userId, email: VALID_INPUT.email } : null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: userId }),
    },
    restaurants: {
      insertOne: vi.fn().mockResolvedValue({ insertedId: restaurantId }),
    },
    financial_accounts: {
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    },
    financial_categories: {
      insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    },
    audit_logs: {
      insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    },
  }

  const session = {
    withTransaction: vi.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
    endSession: vi.fn().mockResolvedValue(undefined),
  }

  const db = {
    collection: vi.fn().mockImplementation((name: string) => collections[name]),
  }

  vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({
    getClient: vi.fn().mockReturnValue({ startSession: vi.fn().mockReturnValue(session) }),
    getDatabase: vi.fn().mockReturnValue(db),
  } as any)

  return { collections, session, db, userId, restaurantId }
}

// ─── setup ───────────────────────────────────────────────────────────────────

describe('RegisterUseCase', () => {
  let useCase: RegisterUseCase
  let jwtMock: any

  beforeEach(() => {
    vi.clearAllMocks()

    jwtMock = {
      generate: vi.fn().mockResolvedValue(MOCK_TOKENS),
    }
    vi.spyOn(jwtModule, 'getJwtService').mockReturnValue(jwtMock)

    useCase = new RegisterUseCase()
  })

  // ── happy path ────────────────────────────────────────────────────────────

  describe('cadastro bem-sucedido', () => {
    it('retorna accessToken e refreshToken', async () => {
      makeMongoMock()

      const result = await useCase.execute(VALID_INPUT)

      expect(result.accessToken).toBe('mock-access')
      expect(result.refreshToken).toBe('mock-refresh')
    })

    it('retorna dados do usuário e do restaurante', async () => {
      makeMongoMock()

      const result = await useCase.execute(VALID_INPUT)

      expect(result.user.name).toBe('João Silva')
      expect(result.user.email).toBe('joao@restaurante.com')
      expect(result.restaurant.name).toBe('Restaurante do João')
      expect(result.restaurant.id).toBeDefined()
    })

    it('cria o usuário com os dados corretos', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.users.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'João Silva', email: 'joao@restaurante.com', termsAccepted: true }),
        expect.anything(),
      )
    })

    it('não armazena a senha em texto puro', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const userDoc = vi.mocked(collections.users.insertOne).mock.calls[0][0]
      expect(userDoc.passwordHash).toBeDefined()
      expect(userDoc.passwordHash).not.toBe('Senha123')
      expect(userDoc.passwordHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/)
    })

    it('cria o restaurante com o nome informado', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.restaurants.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Restaurante do João' }),
        expect.anything(),
      )
    })

    it('vincula o usuário ao restaurante via restaurantId no documento do usuário', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const userDoc = vi.mocked(collections.users.insertOne).mock.calls[0][0]
      expect(userDoc.restaurantId).toBeDefined()
      expect(userDoc.role).toBe('admin')
    })

    it('cria conta financeira padrão do tipo cash', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.financial_accounts.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cash', isActive: true, isDefault: true }),
        expect.anything(),
      )
    })

    it('cria exatamente 6 categorias financeiras padrão', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [categoriesDocs] = vi.mocked(collections.financial_categories.insertMany).mock.calls[0]
      expect(categoriesDocs).toHaveLength(6)
    })

    it('cria categorias com tipos corretos (2 income + 4 expense)', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [categoriesDocs] = vi.mocked(collections.financial_categories.insertMany).mock.calls[0]
      const income = categoriesDocs.filter((c: any) => c.type === 'income')
      const expense = categoriesDocs.filter((c: any) => c.type === 'expense')
      expect(income).toHaveLength(2)
      expect(expense).toHaveLength(4)
    })

    it('todas as categorias padrão têm isSystem true', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [categoriesDocs] = vi.mocked(collections.financial_categories.insertMany).mock.calls[0]
      expect(categoriesDocs.every((c: any) => c.isSystem === true)).toBe(true)
    })

    it('cria os 4 eventos de auditoria', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [auditDocs] = vi.mocked(collections.audit_logs.insertMany).mock.calls[0]
      const events = auditDocs.map((a: any) => a.event)
      expect(events).toContain('account_created')
      expect(events).toContain('restaurant_created')
      expect(events).toContain('terms_accepted')
      expect(events).toContain('onboarding_completed')
    })

    it('gera token com todos os claims necessários para queries sem DB', async () => {
      makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(jwtMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'mintly',
          claims: expect.objectContaining({
            name: 'João Silva',
            email: 'joao@restaurante.com',
            restaurantId: expect.any(String),
            role: 'admin',
            status: 'active',
          }),
        }),
      )
    })

    it('registra termsAcceptedAt no documento do usuário', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const userDoc = vi.mocked(collections.users.insertOne).mock.calls[0][0]
      expect(userDoc.termsAcceptedAt).toBeDefined()
    })

    it('executa tudo dentro de uma única transação', async () => {
      const { session } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(session.withTransaction).toHaveBeenCalledOnce()
      expect(session.endSession).toHaveBeenCalledOnce()
    })
  })

  // ── email duplicado ───────────────────────────────────────────────────────

  describe('e-mail duplicado', () => {
    it('lança ConflictError quando o e-mail já está cadastrado', async () => {
      makeMongoMock({ userExists: true })

      await expect(useCase.execute(VALID_INPUT)).rejects.toBeInstanceOf(ConflictError)
    })

    it('não cria usuário quando o e-mail já existe', async () => {
      const { collections } = makeMongoMock({ userExists: true })

      await useCase.execute(VALID_INPUT).catch(() => null)

      expect(collections.users.insertOne).not.toHaveBeenCalled()
    })

    it('não cria restaurante quando o e-mail já existe', async () => {
      const { collections } = makeMongoMock({ userExists: true })

      await useCase.execute(VALID_INPUT).catch(() => null)

      expect(collections.restaurants.insertOne).not.toHaveBeenCalled()
    })
  })

  // ── validações cross-field ────────────────────────────────────────────────

  describe('validações cross-field', () => {
    it('lança SapphireValidationError quando as senhas não conferem', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, confirmPassword: 'Diferente1' }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('aponta o campo confirmPassword quando as senhas não conferem', async () => {
      makeMongoMock()

      const error = await useCase.execute({ ...VALID_INPUT, confirmPassword: 'Diferente1' }).catch(e => e)
      expect(error.flatten().fieldErrors.confirmPassword).toBeDefined()
    })

    it('lança SapphireValidationError quando acceptedTerms é false', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, acceptedTerms: false }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('lança SapphireValidationError quando acceptedPrivacy é false', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, acceptedPrivacy: false }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })
  })

  // ── validações do schema (field-level) ────────────────────────────────────

  describe('validações de schema (repassa do registerSchema)', () => {
    it('lança SapphireValidationError para e-mail inválido', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, email: 'nao-e-email' }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('lança SapphireValidationError para senha fraca', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, password: 'fraca', confirmPassword: 'fraca' }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('não consulta o MongoDB antes de validar o schema', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute({ ...VALID_INPUT, email: 'invalido' }).catch(() => null)

      expect(collections.users.findOne).not.toHaveBeenCalled()
    })
  })
})
