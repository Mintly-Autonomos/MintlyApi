import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const mockFindByEmail        = vi.hoisted(() => vi.fn())
const mockUpdatePassword     = vi.hoisted(() => vi.fn())
const mockCreateToken        = vi.hoisted(() => vi.fn())
const mockFindValid          = vi.hoisted(() => vi.fn())
const mockMarkUsed           = vi.hoisted(() => vi.fn())
const mockInvalidateAll      = vi.hoisted(() => vi.fn())
const mockSendRecovery       = vi.hoisted(() => vi.fn())
const mockLogAudit           = vi.hoisted(() => vi.fn())
const mockUpdateMany         = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail    = mockFindByEmail
    updatePassword = mockUpdatePassword
  },
}))

vi.mock('../password-reset-repository', () => ({
  PasswordResetRepository: class {
    create               = mockCreateToken
    findValid            = mockFindValid
    markUsed             = mockMarkUsed
    invalidateAllForUser = mockInvalidateAll
  },
}))

vi.mock('../../../infrastructure/email/email-service', () => ({
  getEmailService: vi.fn(() => ({ sendPasswordRecovery: mockSendRecovery })),
}))

vi.mock('../../audit/audit-service', () => ({
  logAudit: mockLogAudit,
}))

vi.mock('../../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: vi.fn(() => ({
      getDatabase: vi.fn(() => ({
        collection: vi.fn(() => ({ updateMany: mockUpdateMany })),
      })),
    })),
  },
}))

// ─── import APÓS os mocks ─────────────────────────────────────────────────────

import { PasswordRecoveryUseCase } from './password-recovery-use-case'

// ─── dados de apoio ───────────────────────────────────────────────────────────

const MOCK_USER = {
  _id: 'user-id-123',
  nome: 'João Silva',
  email: 'joao@restaurante.com',
  status: 'ativo' as const,
  loginAttempts: 0,
  bloqueadoAte: null,
  passwordHash: 'hash',
  termosAceitos: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

const VALID_TOKEN_RECORD = {
  _id: 'token-doc-id',
  token: 'valid-token-hex',
  userId: 'user-id-123',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  usedAt: null,
  createdAt: new Date().toISOString(),
}

// ─── suite ───────────────────────────────────────────────────────────────────

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

  // ── requestRecovery ───────────────────────────────────────────────────────

  describe('requestRecovery', () => {
    it('cria token e envia e-mail quando o usuário existe', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.requestRecovery({ email: 'joao@restaurante.com' })

      expect(mockCreateToken).toHaveBeenCalledOnce()
      expect(mockSendRecovery).toHaveBeenCalledWith('joao@restaurante.com', expect.any(String))
    })

    it('token criado tem 64 caracteres hexadecimais', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.requestRecovery({ email: 'joao@restaurante.com' })

      const [tokenDoc] = mockCreateToken.mock.calls[0]
      expect(tokenDoc.token).toMatch(/^[a-f0-9]{64}$/)
    })

    it('token criado tem expiresAt no futuro', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      const antes = Date.now()

      await useCase.requestRecovery({ email: 'joao@restaurante.com' })

      const [tokenDoc] = mockCreateToken.mock.calls[0]
      expect(new Date(tokenDoc.expiresAt).getTime()).toBeGreaterThan(antes)
    })

    it('invalida tokens anteriores antes de criar novo', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.requestRecovery({ email: 'joao@restaurante.com' })

      const invalidateOrder = mockInvalidateAll.mock.invocationCallOrder[0]
      const createOrder     = mockCreateToken.mock.invocationCallOrder[0]
      expect(invalidateOrder).toBeLessThan(createOrder)
    })

    it('não faz nada quando o e-mail não existe (sem revelar)', async () => {
      mockFindByEmail.mockResolvedValue(null)

      await expect(useCase.requestRecovery({ email: 'inexistente@email.com' }))
        .resolves.toBeUndefined()

      expect(mockCreateToken).not.toHaveBeenCalled()
      expect(mockSendRecovery).not.toHaveBeenCalled()
    })

    it('não faz nada para conta inativa (sem revelar)', async () => {
      mockFindByEmail.mockResolvedValue({ ...MOCK_USER, status: 'inativo' })

      await useCase.requestRecovery({ email: 'joao@restaurante.com' })

      expect(mockCreateToken).not.toHaveBeenCalled()
    })

    it('registra auditoria de senha_recuperacao_solicitada', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.requestRecovery({ email: 'joao@restaurante.com' })

      expect(mockLogAudit).toHaveBeenCalledWith(
        'senha_recuperacao_solicitada',
        'user-id-123',
        expect.objectContaining({ email: 'joao@restaurante.com' }),
      )
    })

    it('lança SapphireValidationError para e-mail inválido', async () => {
      await expect(useCase.requestRecovery({ email: 'nao-e-email' }))
        .rejects.toBeInstanceOf(SapphireValidationError)
    })
  })

  // ── resetPassword ─────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('atualiza a senha com token válido', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)

      await useCase.resetPassword({
        token: 'valid-token-hex',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      })

      expect(mockUpdatePassword).toHaveBeenCalledWith(
        'user-id-123',
        expect.stringMatching(/^[a-f0-9]{32}:[a-f0-9]{128}$/),
      )
    })

    it('marca o token como usado', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)

      await useCase.resetPassword({
        token: 'valid-token-hex',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      })

      expect(mockMarkUsed).toHaveBeenCalledWith('valid-token-hex')
    })

    it('revoga todas as sessões JWT ativas do usuário', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)

      await useCase.resetPassword({
        token: 'valid-token-hex',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      })

      expect(mockUpdateMany).toHaveBeenCalledWith(
        { subject: 'user-id-123', revokedAt: null },
        expect.objectContaining({ $set: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      )
    })

    it('registra auditoria de senha_redefinida', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)

      await useCase.resetPassword({
        token: 'valid-token-hex',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      })

      expect(mockLogAudit).toHaveBeenCalledWith('senha_redefinida', 'user-id-123', {})
    })

    it('lança UnauthorizedError para token inválido ou expirado', async () => {
      mockFindValid.mockResolvedValue(null)

      await expect(useCase.resetPassword({
        token: 'token-invalido',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      })).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('lança SapphireValidationError quando as senhas não conferem', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)

      await expect(useCase.resetPassword({
        token: 'valid-token-hex',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'Diferente1',
      })).rejects.toBeInstanceOf(SapphireValidationError)
    })

    it('não atualiza senha quando token é inválido', async () => {
      mockFindValid.mockResolvedValue(null)

      await useCase.resetPassword({
        token: 'invalido',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      }).catch(() => null)

      expect(mockUpdatePassword).not.toHaveBeenCalled()
    })

    it('não armazena a nova senha em texto puro', async () => {
      mockFindValid.mockResolvedValue(VALID_TOKEN_RECORD)

      await useCase.resetPassword({
        token: 'valid-token-hex',
        novaSenha: 'NovaSenha1',
        confirmarNovaSenha: 'NovaSenha1',
      })

      const [, hash] = mockUpdatePassword.mock.calls[0]
      expect(hash).not.toBe('NovaSenha1')
      expect(hash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/)
    })

    it('lança SapphireValidationError para senha fraca', async () => {
      await expect(useCase.resetPassword({
        token: 'tok',
        novaSenha: 'fraca',
        confirmarNovaSenha: 'fraca',
      })).rejects.toBeInstanceOf(SapphireValidationError)
    })
  })
})
