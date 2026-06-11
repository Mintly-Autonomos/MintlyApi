import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'

import { PasswordRecoveryUseCase } from './password-recovery-use-case'

const mockFindByEmail = vi.hoisted(() => vi.fn())
const mockFindById = vi.hoisted(() => vi.fn())
const mockUpdatePassword = vi.hoisted(() => vi.fn())
const mockCreateToken = vi.hoisted(() => vi.fn())
const mockClaim = vi.hoisted(() => vi.fn())
const mockInvalidateAll = vi.hoisted(() => vi.fn())
const mockSendRecovery = vi.hoisted(() => vi.fn())
const mockLogAudit = vi.hoisted(() => vi.fn())
const mockUpdateMany = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail = mockFindByEmail
    findById = mockFindById
    updatePassword = mockUpdatePassword
  },
}))

vi.mock('../password-reset-repository', () => ({
  PasswordResetRepository: class {
    create = mockCreateToken
    claim = mockClaim
    invalidateAllForUser = mockInvalidateAll
  },
}))

vi.mock('../../../infrastructure/email/email-service', () => ({
  getEmailService: vi.fn(() => ({ sendPasswordRecovery: mockSendRecovery })),
}))

vi.mock('../../audit/audit-service', () => ({ logAudit: mockLogAudit }))

vi.mock('../../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: vi.fn(() => ({
      getDatabase: vi.fn(() => ({ collection: vi.fn(() => ({ updateMany: mockUpdateMany })) })),
    })),
  },
}))

const CTX = { env: 'default' }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const MOCK_USER = {
  _id: 'user-id-123',
  person: { _id: 'p1', name: 'João Silva' },
  email: 'joao@restaurante.com',
  status: 'active' as const,
  role: 'owner' as const,
  restaurantId: 'rest-1',
  passwordHash: 'hash',
}

const VALID_TOKEN_RECORD = {
  _id: 'token-doc-id',
  token: sha256('valid-token-hex'),
  userId: 'user-id-123',
  expiresAt: new Date(Date.now() + 3_600_000),
  usedAt: null,
  createdAt: new Date().toISOString(),
}

describe('PasswordRecoveryUseCase', () => {
  let useCase: PasswordRecoveryUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateToken.mockResolvedValue(undefined)
    mockSendRecovery.mockResolvedValue(undefined)
    mockLogAudit.mockResolvedValue(undefined)
    mockInvalidateAll.mockResolvedValue(undefined)
    mockFindById.mockResolvedValue(MOCK_USER)
    mockUpdatePassword.mockResolvedValue(undefined)
    mockUpdateMany.mockResolvedValue({ modifiedCount: 1 })
    useCase = new PasswordRecoveryUseCase()
  })

  describe('requestRecovery', () => {
    it('cria token e envia e-mail quando o usuário existe', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      expect(mockCreateToken).toHaveBeenCalledOnce()
      expect(mockSendRecovery).toHaveBeenCalledWith('joao@restaurante.com', expect.any(String))
    })

    it('armazena o sha256 do token (não o token em claro) e expiresAt como Date futura', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const antes = Date.now()
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      const [tokenDoc] = mockCreateToken.mock.calls[0]
      const [, sentToken] = mockSendRecovery.mock.calls[0]
      expect(sentToken).toMatch(/^[a-f0-9]{64}$/)
      expect(tokenDoc.token).toBe(sha256(sentToken))
      expect(tokenDoc.token).not.toBe(sentToken)
      expect(tokenDoc.expiresAt).toBeInstanceOf(Date)
      expect(tokenDoc.expiresAt.getTime()).toBeGreaterThan(antes)
    })

    it('invalida tokens anteriores antes de criar novo', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      expect(mockInvalidateAll.mock.invocationCallOrder[0]).toBeLessThan(mockCreateToken.mock.invocationCallOrder[0])
    })

    it('não faz nada quando o e-mail não existe (sem revelar)', async () => {
      mockFindByEmail.mockResolvedValue(null)
      await expect(useCase.requestRecovery({ email: 'inexistente@email.com' }, CTX)).resolves.toBeUndefined()
      expect(mockCreateToken).not.toHaveBeenCalled()
      expect(mockSendRecovery).not.toHaveBeenCalled()
    })

    it('não faz nada para conta inativa (sem revelar)', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'inactive' })
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      expect(mockCreateToken).not.toHaveBeenCalled()
    })

    it('não propaga falha do envio de e-mail (fire-and-forget)', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      mockSendRecovery.mockRejectedValue(new Error('smtp indisponível'))
      await expect(useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)).resolves.toBeUndefined()
      expect(mockCreateToken).toHaveBeenCalledOnce()
    })

    it('registra auditoria de password_recovery_requested com restaurantId', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      expect(mockLogAudit).toHaveBeenCalledWith(
        'password_recovery_requested', 'user-id-123', expect.objectContaining({ email: 'joao@restaurante.com' }), 'rest-1', 'default',
      )
    })

    it('lança erro de validação para e-mail inválido', async () => {
      const err = await useCase.requestRecovery({ email: 'nao-e-email' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
    })
  })

  describe('resetPassword', () => {
    const resetInput = { token: 'valid-token-hex', newPassword: 'NovaSenha1', confirmNewPassword: 'NovaSenha1' }

    it('atualiza a senha (hash) com token válido', async () => {
      mockClaim.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockUpdatePassword).toHaveBeenCalledWith('user-id-123', expect.stringMatching(/^[a-f0-9]{32}:[a-f0-9]{128}$/), CTX)
    })

    it('consome o token atomicamente via claim, usando o hash do token', async () => {
      mockClaim.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockClaim).toHaveBeenCalledExactlyOnceWith(sha256('valid-token-hex'))
    })

    it('revoga todas as sessões JWT ativas do usuário', async () => {
      mockClaim.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockUpdateMany).toHaveBeenCalledWith(
        { subject: 'user-id-123', revokedAt: null },
        expect.objectContaining({ $set: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      )
    })

    it('registra auditoria de password_reset com restaurantId', async () => {
      mockClaim.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockLogAudit).toHaveBeenCalledWith('password_reset', 'user-id-123', {}, 'rest-1', 'default')
    })

    it('lança UnauthorizedError para token inválido, expirado ou já usado', async () => {
      mockClaim.mockResolvedValue(null)
      await expect(useCase.resetPassword({ ...resetInput, token: 'invalido' }, CTX)).rejects.toBeInstanceOf(UnauthorizedError)
      expect(mockUpdatePassword).not.toHaveBeenCalled()
    })

    it('lança erro de validação quando as senhas não conferem (sem consumir o token)', async () => {
      const err = await useCase.resetPassword({ ...resetInput, confirmNewPassword: 'Diferente1' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
      expect(mockClaim).not.toHaveBeenCalled()
    })

    it('lança erro de validação para senha fraca', async () => {
      const err = await useCase.resetPassword({ token: 'tok', newPassword: 'fraca', confirmNewPassword: 'fraca' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
    })
  })
})
