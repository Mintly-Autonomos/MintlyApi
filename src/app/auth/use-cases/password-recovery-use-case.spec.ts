import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'

import { PasswordRecoveryUseCase } from './password-recovery-use-case'

const mockFindByEmail = vi.hoisted(() => vi.fn())
const mockUpdatePassword = vi.hoisted(() => vi.fn())
const mockCreateToken = vi.hoisted(() => vi.fn())
const mockFindValid = vi.hoisted(() => vi.fn())
const mockMarkUsed = vi.hoisted(() => vi.fn())
const mockInvalidateAll = vi.hoisted(() => vi.fn())
const mockSendRecovery = vi.hoisted(() => vi.fn())
const mockLogAudit = vi.hoisted(() => vi.fn())
const mockUpdateMany = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail = mockFindByEmail
    updatePassword = mockUpdatePassword
  },
}))

vi.mock('../password-reset-repository', () => ({
  PasswordResetRepository: class {
    create = mockCreateToken
    findValid = mockFindValid
    markUsed = mockMarkUsed
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

const MOCK_USER = {
  _id: 'user-id-123',
  person: { _id: 'p1', name: 'João Silva' },
  email: 'joao@restaurante.com',
  status: 'active' as const,
  role: 'owner' as const,
  passwordHash: 'hash',
}

const VALID_TOKEN_RECORD = {
  _id: 'token-doc-id',
  token: 'valid-token-hex',
  userId: 'user-id-123',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
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
    mockMarkUsed.mockResolvedValue(undefined)
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

    it('token criado tem 64 caracteres hexadecimais e expiresAt no futuro', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const antes = Date.now()
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      const [tokenDoc] = mockCreateToken.mock.calls[0]
      expect(tokenDoc.token).toMatch(/^[a-f0-9]{64}$/)
      expect(new Date(tokenDoc.expiresAt).getTime()).toBeGreaterThan(antes)
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

    it('registra auditoria de password_recovery_requested', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.requestRecovery({ email: 'joao@restaurante.com' }, CTX)
      expect(mockLogAudit).toHaveBeenCalledWith(
        'password_recovery_requested', 'user-id-123', expect.objectContaining({ email: 'joao@restaurante.com' }), undefined, 'default',
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
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockUpdatePassword).toHaveBeenCalledWith('user-id-123', expect.stringMatching(/^[a-f0-9]{32}:[a-f0-9]{128}$/), CTX)
    })

    it('marca o token como usado', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockMarkUsed).toHaveBeenCalledWith('valid-token-hex')
    })

    it('revoga todas as sessões JWT ativas do usuário', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockUpdateMany).toHaveBeenCalledWith(
        { subject: 'user-id-123', revokedAt: null },
        expect.objectContaining({ $set: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      )
    })

    it('registra auditoria de password_reset', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)
      await useCase.resetPassword(resetInput, CTX)
      expect(mockLogAudit).toHaveBeenCalledWith('password_reset', 'user-id-123', {}, undefined, 'default')
    })

    it('lança UnauthorizedError para token inválido ou expirado', async () => {
      mockFindValid.mockResolvedValue(null)
      await expect(useCase.resetPassword({ ...resetInput, token: 'invalido' }, CTX)).rejects.toBeInstanceOf(UnauthorizedError)
      expect(mockUpdatePassword).not.toHaveBeenCalled()
    })

    it('lança erro de validação quando as senhas não conferem', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)
      const err = await useCase.resetPassword({ ...resetInput, confirmNewPassword: 'Diferente1' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
    })

    it('lança erro de validação para senha fraca', async () => {
      const err = await useCase.resetPassword({ token: 'tok', newPassword: 'fraca', confirmNewPassword: 'fraca' }, CTX).catch(e => e)
      expect(err.name).toBe('SapphireValidationError')
    })
  })
})
