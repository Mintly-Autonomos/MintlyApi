import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes, scryptSync } from 'crypto'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'
import { User } from '../../user/user'

// ─── hoisted mocks (disponíveis no factory E nos testes) ─────────────────────

const mockFindByEmail    = vi.hoisted(() => vi.fn())
const mockUpdateLastAcc  = vi.hoisted(() => vi.fn())
const mockGenerate       = vi.hoisted(() => vi.fn())
const mockRefreshJwt     = vi.hoisted(() => vi.fn())
const mockRevokeRefresh  = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail   = mockFindByEmail
    updateLastAccess = mockUpdateLastAcc
  },
}))

vi.mock('../../../infrastructure/jwt/jwt-service', () => ({
  getJwtService: vi.fn(() => ({
    generate:            mockGenerate,
    refresh:             mockRefreshJwt,
    revokeRefreshToken:  mockRevokeRefresh,
  })),
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
  nome: 'João Silva',
  email: 'joao@restaurante.com',
  passwordHash: makePasswordHash('Senha123'),
  termosAceitos: true,
  aceitouTermosEm: '2024-01-01T00:00:00.000Z',
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
    mockGenerate.mockResolvedValue(MOCK_TOKENS)
    useCase = new AuthUseCase()
  })

  // ── login ─────────────────────────────────────────────────────────────────

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

      expect(result.user.nome).toBe('João Silva')
      expect(result.user.email).toBe('joao@restaurante.com')
    })

    it('gera token com claims corretos (nome e email)', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Senha123')

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'mintly',
          subject: 'user-id-123',
          claims: expect.objectContaining({ nome: 'João Silva', email: 'joao@restaurante.com' }),
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

    it('atualiza ultimoAcesso após login bem-sucedido', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)

      await useCase.login('joao@restaurante.com', 'Senha123')

      expect(mockUpdateLastAcc).toHaveBeenCalledWith('user-id-123')
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
  })
})
