import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes, scryptSync } from 'crypto'
import { UnauthorizedError } from '../../../core/errors/auth/unauthorized-error'

import { AuthUseCase } from './auth-use-case'
import * as jwtModule from '../../../infrastructure/jwt/jwt-service'

const mockFindByEmail = vi.hoisted(() => vi.fn())
const mockUpdateLastAccess = vi.hoisted(() => vi.fn())
const mockGenerate = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockRevoke = vi.hoisted(() => vi.fn())

vi.mock('../auth-repository', () => ({
  AuthRepository: class {
    findByEmail = mockFindByEmail
    updateLastAccess = mockUpdateLastAccess
  },
}))

vi.mock('../../../infrastructure/jwt/jwt-service', () => ({
  getJwtService: vi.fn(() => ({
    generate: mockGenerate,
    refresh: mockRefresh,
    revokeRefreshToken: mockRevoke,
  })),
}))

const CTX = { env: 'default' }

function makePasswordHash (password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const MOCK_USER = {
  _id: 'user-id-123',
  person: { _id: 'person-id-1', name: 'João Silva' },
  email: 'joao@restaurante.com',
  passwordHash: makePasswordHash('Senha123'),
  role: 'owner',
  status: 'active',
  restaurantId: 'rest-id-1',
  audit: { createdAt: 't', updatedAt: 't' },
}

const MOCK_TOKENS = { accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' }

describe('AuthUseCase', () => {
  let useCase: AuthUseCase

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateLastAccess.mockResolvedValue(undefined)
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

    it('gera token com claims name, email, role e restaurantId', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.login('joao@restaurante.com', 'Senha123', CTX)
      expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'mintly',
        subject: 'user-id-123',
        claims: expect.objectContaining({
          name: 'João Silva', email: 'joao@restaurante.com', role: 'owner', restaurantId: 'rest-id-1',
        }),
      }))
    })

    it('atualiza lastAccess após login', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await useCase.login('joao@restaurante.com', 'Senha123', CTX)
      expect(mockUpdateLastAccess).toHaveBeenCalledWith('user-id-123', CTX)
    })

    it('lança UnauthorizedError quando o usuário não existe', async () => {
      mockFindByEmail.mockResolvedValue(null)
      await expect(useCase.login('x@x.com', 'Senha123', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('lança UnauthorizedError quando a senha está errada', async () => {
      mockFindByEmail.mockResolvedValue(MOCK_USER)
      await expect(useCase.login('joao@restaurante.com', 'Errada1', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
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
      mockRefresh.mockResolvedValue({ succeeded: true, tokens: { accessToken: 'novo-a', refreshToken: 'novo-r' } })
      const result = await useCase.refresh('valid', CTX)
      expect(result.accessToken).toBe('novo-a')
      expect(result.refreshToken).toBe('novo-r')
    })

    it('lança UnauthorizedError para refresh inválido', async () => {
      mockRefresh.mockResolvedValue({ succeeded: false, failureReason: 'Token revogado', tokens: null })
      await expect(useCase.refresh('bad', CTX)).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })

  describe('logout', () => {
    it('revoga o refresh token', async () => {
      await useCase.logout('rt', CTX)
      expect(mockRevoke).toHaveBeenCalledWith('rt')
    })
  })
})
