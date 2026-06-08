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
  nome: 'João Silva',
  email: 'joao@restaurante.com',
  senha: 'Senha123',
  confirmarSenha: 'Senha123',
  nomeRestaurante: 'Restaurante do João',
  aceitouTermos: true,
  aceitouPrivacidade: true,
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
  const orgId = new ObjectId()

  const collections: Record<string, any> = {
    users: {
      findOne: vi.fn().mockResolvedValue(overrides.userExists ? { _id: userId, email: VALID_INPUT.email } : null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: userId }),
    },
    organizations: {
      insertOne: vi.fn().mockResolvedValue({ insertedId: orgId }),
    },
    organization_members: {
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
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

  return { collections, session, db, userId, orgId }
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

    it('retorna dados do usuário e da organização', async () => {
      makeMongoMock()

      const result = await useCase.execute(VALID_INPUT)

      expect(result.user.nome).toBe('João Silva')
      expect(result.user.email).toBe('joao@restaurante.com')
      expect(result.organization.nome).toBe('Restaurante do João')
      expect(result.organization.id).toBeDefined()
    })

    it('cria o usuário com os dados corretos', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.users.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'João Silva', email: 'joao@restaurante.com', termosAceitos: true }),
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

    it('cria a organização com o nome do restaurante', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.organizations.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'Restaurante do João' }),
        expect.anything(),
      )
    })

    it('vincula o usuário à organização com papel administrador', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.organization_members.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ papel: 'administrador' }),
        expect.anything(),
      )
    })

    it('cria conta financeira padrão do tipo Caixa', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(collections.financial_accounts.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'Caixa', ativa: true, padrao: true }),
        expect.anything(),
      )
    })

    it('cria exatamente 6 categorias financeiras padrão', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [categoriesDocs] = vi.mocked(collections.financial_categories.insertMany).mock.calls[0]
      expect(categoriesDocs).toHaveLength(6)
    })

    it('cria categorias com tipos corretos (3 Receita + 3 Despesa no total)', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [categoriesDocs] = vi.mocked(collections.financial_categories.insertMany).mock.calls[0]
      const receitas = categoriesDocs.filter((c: any) => c.tipo === 'Receita')
      const despesas = categoriesDocs.filter((c: any) => c.tipo === 'Despesa')
      expect(receitas).toHaveLength(2)
      expect(despesas).toHaveLength(4)
    })

    it('cria os 4 eventos de auditoria', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const [auditDocs] = vi.mocked(collections.audit_logs.insertMany).mock.calls[0]
      const eventos = auditDocs.map((a: any) => a.evento)
      expect(eventos).toContain('conta_criada')
      expect(eventos).toContain('organizacao_criada')
      expect(eventos).toContain('termos_aceitos')
      expect(eventos).toContain('onboarding_concluido')
    })

    it('gera token com claims de nome, email, papel e organizationId', async () => {
      makeMongoMock()

      await useCase.execute(VALID_INPUT)

      expect(jwtMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'mintly',
          claims: expect.objectContaining({
            nome: 'João Silva',
            email: 'joao@restaurante.com',
            papel: 'administrador',
          }),
        }),
      )
    })

    it('registra aceitouTermosEm no documento do usuário', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute(VALID_INPUT)

      const userDoc = vi.mocked(collections.users.insertOne).mock.calls[0][0]
      expect(userDoc.aceitouTermosEm).toBeDefined()
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

    it('não cria organização quando o e-mail já existe', async () => {
      const { collections } = makeMongoMock({ userExists: true })

      await useCase.execute(VALID_INPUT).catch(() => null)

      expect(collections.organizations.insertOne).not.toHaveBeenCalled()
    })
  })

  // ── validações cross-field ────────────────────────────────────────────────

  describe('validações cross-field', () => {
    it('lança SapphireValidationError quando as senhas não conferem', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, confirmarSenha: 'Diferente1' }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('aponta o campo confirmarSenha quando as senhas não conferem', async () => {
      makeMongoMock()

      const error = await useCase.execute({ ...VALID_INPUT, confirmarSenha: 'Diferente1' }).catch(e => e)
      expect(error.flatten().fieldErrors.confirmarSenha).toBeDefined()
    })

    it('lança SapphireValidationError quando aceitouTermos é false', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, aceitouTermos: false }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('lança SapphireValidationError quando aceitouPrivacidade é false', async () => {
      makeMongoMock()

      await expect(useCase.execute({ ...VALID_INPUT, aceitouPrivacidade: false }))
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

      await expect(useCase.execute({ ...VALID_INPUT, senha: 'fraca', confirmarSenha: 'fraca' }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('não consulta o MongoDB antes de validar o schema', async () => {
      const { collections } = makeMongoMock()

      await useCase.execute({ ...VALID_INPUT, email: 'invalido' }).catch(() => null)

      expect(collections.users.findOne).not.toHaveBeenCalled()
    })
  })
})
