import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes, scryptSync } from 'crypto'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { ForbiddenError } from '../../../core/errors/auth/forbidden-error'
import { TooManyRequestsError } from '../../../core/errors/auth/too-many-requests-error'
import { User } from '../../user/user'

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const mockFindByEmail          = vi.hoisted(() => vi.fn())
const mockUpdateLastAcc        = vi.hoisted(() => vi.fn())
const mockIncrementAttempts    = vi.hoisted(() => vi.fn())
const mockResetAttempts        = vi.hoisted(() => vi.fn())
const mockSetTemporaryBlock    = vi.hoisted(() => vi.fn())
const mockGenerate             = vi.hoisted(() => vi.fn())
const mockRefreshJwt           = vi.hoisted(() => vi.fn())
const mockRevokeRefresh        = vi.hoisted(() => vi.fn())
const mockLogAudit             = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail          = mockFindByEmail
    updateLastAccess     = mockUpdateLastAcc
    incrementLoginAttempts = mockIncrementAttempts
    resetLoginAttempts   = mockResetAttempts
    setTemporaryBlock    = mockSetTemporaryBlock
  },
}))

vi.mock('../../../infrastructure/jwt/jwt-service', () => ({
  getJwtService: vi.fn(() => ({
    generate:            mockGenerate,
    refresh:             mockRefreshJwt,
    revokeRefreshToken:  mockRevokeRefresh,
  })),
}))

vi.mock('../../audit/audit-service', () => ({
  logAudit: mockLogAudit,
}))

// ─── import APÓS os mocks ─────────────────────────────────────────────────────

import { AuthUseCase } from './auth-use-case'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePasswordHash (password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const MOCK_USER: User = {
  _id: 'user-id-123',
  name: 'João Silva',
  email: 'joao@restaurante.com',
  passwordHash: makePasswordHash('Senha123'),
  status: 'active',
  role: 'admin',
  restaurantId: 'rest-id-456',
  loginAttempts: 0,
  blockedUntil: null,
  termsAccepted: true,
  termsAcceptedAt: '2024-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

const MOCK_TOKENS = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  accessTokenId: 'atid',
  accessTokenExpiresAt: new Date(),
  refreshTokenId: 'rtid',
  refreshTokenExpiresAt: new Date(),
  tenantId: 'mintly',
  subject: 'user-id-123',
  keyId: 'kid',
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('AuthUseCase', () => {
  let useCase: AuthUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateLastAcc.mockResolvedValue(undefined)
    mockResetAttempts.mockResolvedValue(undefined)
    mockIncrementAttempts.mockResolvedValue(1)
    mockSetTemporaryBlock.mockResolvedValue(undefined)
    mockGenerate.mockResolvedValue(MOCK_TOKENS)
    mockLogAudit.mockResolvedValue(undefined)
    useCase = new AuthUseCase()
  })

  // ── login — happy path ────────────────────────────────────────────────────

  describe('login', () => {
    it('retorna accessToken e refreshToken com credenciais válidas', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      const result = await useCase.login('joao@restaurante.com', 'Senha123')

      expect(result.accessToken).toBe('mock-access-token')
      expect(result.refreshToken).toBe('mock-refresh-token')
    })

    it('retorna dados do usuário no login', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      const result = await useCase.login('joao@restaurante.com', 'Senha123')

      expect(result.user.name).toBe('João Silva')
      expect(result.user.email).toBe('joao@restaurante.com')
    })

    it('gera token com todos os claims necessários para queries sem DB', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Senha123')

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'mintly',
          subject: 'user-id-123',
          claims: expect.objectContaining({
            name: 'João Silva',
            email: 'joao@restaurante.com',
            restaurantId: 'rest-id-456',
            role: 'admin',
            status: 'active',
          }),
        }),
      )
    })

    it('inclui cpf nos claims quando o usuário possui cpf', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, cpf: '123.456.789-00' })

      await useCase.login('joao@restaurante.com', 'Senha123')

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: expect.objectContaining({ cpf: '123.456.789-00' }),
        }),
      )
    })

    it('atualiza lastAccessAt após login bem-sucedido', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Senha123')

      expect(mockUpdateLastAcc).toHaveBeenCalledWith('user-id-123')
    })

    it('reseta loginAttempts após login bem-sucedido', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Senha123')

      expect(mockResetAttempts).toHaveBeenCalledWith('user-id-123')
    })

    it('registra auditoria de login com ip e userAgent', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Senha123', {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      })

      expect(mockLogAudit).toHaveBeenCalledWith(
        'login',
        'user-id-123',
        expect.objectContaining({ ip: '192.168.1.1', userAgent: 'Mozilla/5.0' }),
        undefined,
        'default',
      )
    })
  })

  // ── login — erros de credenciais ──────────────────────────────────────────

  describe('login — credenciais inválidas', () => {
    it('lança UnauthorizedError quando o usuário não existe', async () => {
      mockFindByEmail.mockResolvedValue(null)

      await expect(useCase.login('inexistente@email.com', 'Senha123'))
        .rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('lança UnauthorizedError quando a senha está errada', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await expect(useCase.login('joao@restaurante.com', 'SenhaErrada1'))
        .rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('não vaza informação sobre qual campo está errado (email vs senha)', async () => {
      mockFindByEmail.mockResolvedValue(null)
      const errUser = await useCase.login('x@x.com', 'Senha123').catch(e => e)

      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const errPass = await useCase.login('joao@restaurante.com', 'Errada1!').catch(e => e)

      expect(errUser.message).toBe(errPass.message)
    })

    it('incrementa loginAttempts ao falhar senha', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Errada1').catch(() => null)

      expect(mockIncrementAttempts).toHaveBeenCalledWith('user-id-123')
    })

    it('registra auditoria de login_failed', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Errada1').catch(() => null)

      expect(mockLogAudit).toHaveBeenCalledWith(
        'login_failed',
        'user-id-123',
        expect.objectContaining({ attempt: 1 }),
        undefined,
        'default',
      )
    })

    it('bloqueia temporariamente após MAX tentativas', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      mockIncrementAttempts.mockResolvedValue(5)

      await useCase.login('joao@restaurante.com', 'Errada1').catch(() => null)

      expect(mockSetTemporaryBlock).toHaveBeenCalledOnce()
      expect(mockLogAudit).toHaveBeenCalledWith(
        'account_temporarily_blocked',
        'user-id-123',
        expect.objectContaining({ attempts: 5 }),
        undefined,
        'default',
      )
    })

    it('não bloqueia antes de atingir MAX tentativas', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      mockIncrementAttempts.mockResolvedValue(3)

      await useCase.login('joao@restaurante.com', 'Errada1').catch(() => null)

      expect(mockSetTemporaryBlock).not.toHaveBeenCalled()
    })
  })

  // ── login — status da conta ───────────────────────────────────────────────

  describe('login — status da conta', () => {
    it('lança ForbiddenError para conta inativa', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'inactive' })

      await expect(useCase.login('joao@restaurante.com', 'Senha123'))
        .rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lança ForbiddenError para conta bloqueada permanentemente', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'blocked' })

      await expect(useCase.login('joao@restaurante.com', 'Senha123'))
        .rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lança TooManyRequestsError para bloqueio temporário ativo', async () => {
      const futuro = new Date(Date.now() + 10 * 60_000).toISOString()
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, blockedUntil: futuro })

      await expect(useCase.login('joao@restaurante.com', 'Senha123'))
        .rejects.toBeInstanceOf(TooManyRequestsError)
    })

    it('permite login quando bloqueio temporário expirou', async () => {
      const passado = new Date(Date.now() - 1).toISOString()
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, blockedUntil: passado })

      await expect(useCase.login('joao@restaurante.com', 'Senha123'))
        .resolves.toBeDefined()
    })

    it('mensagem de bloqueio informa tempo restante em minutos', async () => {
      const futuro = new Date(Date.now() + 15 * 60_000).toISOString()
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, blockedUntil: futuro })

      const err = await useCase.login('joao@restaurante.com', 'Senha123').catch(e => e)

      expect(err.message).toMatch(/minuto/)
    })
  })

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('retorna novos tokens com refresh token válido', async () => {
      mockRefreshJwt.mockResolvedValue({
        succeeded: true,
        failureReason: null,
        tokens: { accessToken: 'novo-access', refreshToken: 'novo-refresh' },
      })

      const result = await useCase.refresh('valid-refresh-token')

      expect(result.accessToken).toBe('novo-access')
      expect(result.refreshToken).toBe('novo-refresh')
    })

    it('lança UnauthorizedError quando o refresh token é inválido', async () => {
      mockRefreshJwt.mockResolvedValue({ succeeded: false, failureReason: 'Token revogado', tokens: null })

      await expect(useCase.refresh('invalid-token')).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('usa a razão de falha do jwt no erro', async () => {
      mockRefreshJwt.mockResolvedValue({ succeeded: false, failureReason: 'Token expirado', tokens: null })

      const error = await useCase.refresh('expired-token').catch(e => e)

      expect(error.message).toBe('Token expirado')
    })

    it('lança UnauthorizedError quando tokens é null mesmo com succeeded false', async () => {
      mockRefreshJwt.mockResolvedValue({ succeeded: false, failureReason: null, tokens: null })

      await expect(useCase.refresh('token')).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })

  // ── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revoga o refresh token', async () => {
      await useCase.logout('some-refresh-token')

      expect(mockRevokeRefresh).toHaveBeenCalledWith('some-refresh-token')
    })

    it('não retorna nada (void)', async () => {
      const result = await useCase.logout('some-refresh-token')
      expect(result).toBeUndefined()
    })

    it('registra auditoria de logout quando userId é informado', async () => {
      await useCase.logout('some-refresh-token', 'user-id-123')

      expect(mockLogAudit).toHaveBeenCalledWith('logout', 'user-id-123', {}, undefined, 'default')
    })

    it('não registra auditoria de logout sem userId', async () => {
      await useCase.logout('some-refresh-token')

      expect(mockLogAudit).not.toHaveBeenCalled()
    })
  })
})
