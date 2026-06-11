import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes, scryptSync } from 'crypto'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ForbiddenError } from '../../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../../core/errors/auth/too-many-requests-error'

import { AuthUseCase } from './auth-use-case'
import * as jwtModule from '../../../infrastructure/jwt/jwt-service'

const mockFindByEmail = vi.hoisted(() => vi.fn())
const mockUpdateLastAccess = vi.hoisted(() => vi.fn())
const mockResetAttempts = vi.hoisted(() => vi.fn())
const mockIncrementAttempts = vi.hoisted(() => vi.fn())
const mockSetBlock = vi.hoisted(() => vi.fn())
const mockGenerate = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockRevoke = vi.hoisted(() => vi.fn())
const mockLogAudit = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail = mockFindByEmail
    updateLastAccess = mockUpdateLastAccess
    resetLoginAttempts = mockResetAttempts
    incrementLoginAttempts = mockIncrementAttempts
    setTemporaryBlock = mockSetBlock
  },
}))

vi.mock('../../../infrastructure/jwt/jwt-service', () => ({
  getJwtService: vi.fn(() => ({ generate: mockGenerate, refresh: mockRefresh, revokeRefreshToken: mockRevoke })),
}))

vi.mock('../../audit/audit-service', () => ({ logAudit: mockLogAudit }))

const CTX = { env: 'default' }

function makePasswordHash (password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const MOCK_USER = {
  _id: 'user-id-123',
  person: { _id: 'person-1', name: 'João Silva' },
  email: 'joao@restaurante.com',
  passwordHash: makePasswordHash('Senha123'),
  role: 'owner',
  status: 'active',
  restaurantId: 'rest-1',
  loginAttempts: 0,
  blockedUntil: null,
  audit: { createdAt: 't', updatedAt: 't' },
}

const MOCK_TOKENS = { accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' }

describe('AuthUseCase', () => {
  let useCase: AuthUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateLastAccess.mockResolvedValue(undefined)
    mockResetAttempts.mockResolvedValue(undefined)
    mockIncrementAttempts.mockResolvedValue(1)
    mockSetBlock.mockResolvedValue(undefined)
    mockLogAudit.mockResolvedValue(undefined)
    mockGenerate.mockResolvedValue(MOCK_TOKENS)
    useCase = new AuthUseCase()
  })

  describe('login', () => {
    it('retorna tokens com credenciais válidas', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const result = await useCase.login('joao@restaurante.com', 'Senha123', CTX)
      expect(result.accessToken).toBe('mock-access-token')
      expect(result.refreshToken).toBe('mock-refresh-token')
    })

    it('retorna o usuário sem passwordHash', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const result = await useCase.login('joao@restaurante.com', 'Senha123', CTX)
      expect(result.user.email).toBe('joao@restaurante.com')
      expect((result.user as any).passwordHash).toBeUndefined()
    })

    it('gera token com claims name, email, role, restaurantId e status', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.login('joao@restaurante.com', 'Senha123', CTX)
      expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'mintly',
        subject: 'user-id-123',
        claims: expect.objectContaining({
          name: 'João Silva', email: 'joao@restaurante.com', role: 'owner', restaurantId: 'rest-1', status: 'active',
        }),
      }))
    })

    it('reseta tentativas e atualiza lastAccess após login', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.login('joao@restaurante.com', 'Senha123', CTX)
      expect(mockResetAttempts).toHaveBeenCalledWith('user-id-123', CTX)
      expect(mockUpdateLastAccess).toHaveBeenCalledWith('user-id-123', CTX)
    })

    it('registra auditoria de login com ip/userAgent', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.login('joao@restaurante.com', 'Senha123', CTX, { ip: '1.2.3.4', userAgent: 'jest' })
      expect(mockLogAudit).toHaveBeenCalledWith('login', 'user-id-123', expect.objectContaining({ ip: '1.2.3.4' }), 'rest-1', 'default')
    })

    it('lança UnauthorizedError quando o usuário não existe', async () => {
      mockFindByEmail.mockResolvedValue(null)
      await expect(useCase.login('x@x.com', 'Senha123', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('conta inativa lança ForbiddenError', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'inactive' })
      await expect(useCase.login('joao@restaurante.com', 'Senha123', CTX)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('conta bloqueada lança ForbiddenError', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'blocked' })
      await expect(useCase.login('joao@restaurante.com', 'Senha123', CTX)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('senha errada em conta inativa devolve erro genérico (não revela status)', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'inactive' })
      await expect(useCase.login('joao@restaurante.com', 'Errada1', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('bloqueio temporário ativo lança TooManyRequestsError', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, blockedUntil: new Date(Date.now() + 600_000).toISOString() })
      await expect(useCase.login('joao@restaurante.com', 'Senha123', CTX)).rejects.toBeInstanceOf(TooManyRequestsError)
    })

    it('senha errada incrementa tentativas, audita e lança UnauthorizedError', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await expect(useCase.login('joao@restaurante.com', 'Errada1', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
      expect(mockIncrementAttempts).toHaveBeenCalledWith('user-id-123', CTX)
      expect(mockLogAudit).toHaveBeenCalledWith('login_failed', 'user-id-123', expect.anything(), 'rest-1', 'default')
    })

    it('ao atingir o limite de tentativas, bloqueia temporariamente', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      mockIncrementAttempts.mockResolvedValue(5)
      await useCase.login('joao@restaurante.com', 'Errada1', CTX).catch(() => null)
      expect(mockSetBlock).toHaveBeenCalled()
      expect(mockLogAudit).toHaveBeenCalledWith('account_temporarily_blocked', 'user-id-123', expect.anything(), 'rest-1', 'default')
    })

    it('não vaza qual campo está errado (email vs senha)', async () => {
      mockFindByEmail.mockResolvedValue(null)
      const e1 = await useCase.login('x@x.com', 'Senha123', CTX).catch(e => e)
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const e2 = await useCase.login('joao@restaurante.com', 'Errada1', CTX).catch(e => e)
      expect(e1.message).toBe(e2.message)
    })

    it('roteia o jwt service pelo env do contexto', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.login('joao@restaurante.com', 'Senha123', { env: 'e2e' })
      expect(jwtModule.getJwtService).toHaveBeenCalledWith('e2e')
    })
  })

  describe('refresh', () => {
    it('retorna novos tokens com refresh válido', async () => {
      mockRefresh.mockResolvedValue({ succeeded: true, tokens: { accessToken: 'na', refreshToken: 'nr' } })
      const r = await useCase.refresh('valid', CTX)
      expect(r.accessToken).toBe('na')
      expect(r.refreshToken).toBe('nr')
    })

    it('lança UnauthorizedError para refresh inválido', async () => {
      mockRefresh.mockResolvedValue({ succeeded: false, failureReason: 'x', tokens: null })
      await expect(useCase.refresh('bad', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })

  describe('logout', () => {
    it('revoga o refresh token e audita com restaurantId quando há userId', async () => {
      await useCase.logout('rt', CTX, 'user-id-123', 'rest-1')
      expect(mockRevoke).toHaveBeenCalledWith('rt')
      expect(mockLogAudit).toHaveBeenCalledWith('logout', 'user-id-123', {}, 'rest-1', 'default')
    })

    it('revoga sem auditar quando não há userId', async () => {
      await useCase.logout('rt', CTX)
      expect(mockRevoke).toHaveBeenCalledWith('rt')
      expect(mockLogAudit).not.toHaveBeenCalled()
    })
  })
})
