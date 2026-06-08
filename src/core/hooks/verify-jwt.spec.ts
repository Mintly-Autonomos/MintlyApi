import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyJwt } from './verify-jwt'
import * as jwtModule from '../../infrastructure/jwt/jwt-service'

vi.mock('../../infrastructure/jwt/jwt-service')

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReply () {
  const reply: any = {}
  reply.status = vi.fn().mockReturnValue(reply)
  reply.send = vi.fn().mockReturnValue(reply)
  return reply
}

function makeRequest (authorization?: string): any {
  return { headers: authorization ? { authorization } : {} }
}

// ─── testes ──────────────────────────────────────────────────────────────────

describe('verifyJwt', () => {
  let jwtMock: any

  beforeEach(() => {
    vi.clearAllMocks()

    jwtMock = { validate: vi.fn() }
    vi.spyOn(jwtModule, 'getJwtService').mockReturnValue(jwtMock)
  })

  // ── header ausente / malformado ───────────────────────────────────────────

  describe('Authorization header ausente ou malformado', () => {
    it('retorna 401 quando o header Authorization está ausente', async () => {
      const reply = makeReply()
      await verifyJwt(makeRequest(), reply)

      expect(reply.status).toHaveBeenCalledWith(401)
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      )
    })

    it('retorna 401 quando o header não começa com "Bearer "', async () => {
      const reply = makeReply()
      await verifyJwt(makeRequest('Basic dXNlcjpwYXNz'), reply)

      expect(reply.status).toHaveBeenCalledWith(401)
    })

    it('não chama jwt.validate quando não há token', async () => {
      const reply = makeReply()
      await verifyJwt(makeRequest(), reply)

      expect(jwtMock.validate).not.toHaveBeenCalled()
    })
  })

  // ── token inválido ────────────────────────────────────────────────────────

  describe('token inválido', () => {
    it('retorna 401 quando o token não é válido', async () => {
      jwtMock.validate.mockResolvedValue({ succeeded: false, failureReason: 'Token expirado' })
      const reply = makeReply()

      await verifyJwt(makeRequest('Bearer token-invalido'), reply)

      expect(reply.status).toHaveBeenCalledWith(401)
    })

    it('retorna a razão da falha na resposta', async () => {
      jwtMock.validate.mockResolvedValue({ succeeded: false, failureReason: 'Token revogado' })
      const reply = makeReply()

      await verifyJwt(makeRequest('Bearer token'), reply)

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token revogado' }),
      )
    })

    it('retorna mensagem genérica quando failureReason é null', async () => {
      jwtMock.validate.mockResolvedValue({ succeeded: false, failureReason: null })
      const reply = makeReply()

      await verifyJwt(makeRequest('Bearer token'), reply)

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token inválido' }),
      )
    })
  })

  // ── token válido ──────────────────────────────────────────────────────────

  describe('token válido', () => {
    const validResult = {
      succeeded: true,
      failureReason: null,
      subject: 'user-123',
      tenantId: 'mintly',
      claims: { nome: 'João', email: 'joao@test.com' },
    }

    it('não chama reply.send quando o token é válido', async () => {
      jwtMock.validate.mockResolvedValue(validResult)
      const reply = makeReply()

      await verifyJwt(makeRequest('Bearer valid-token'), reply)

      expect(reply.send).not.toHaveBeenCalled()
    })

    it('anexa jwtClaims ao request', async () => {
      jwtMock.validate.mockResolvedValue(validResult)
      const reply = makeReply()
      const request = makeRequest('Bearer valid-token')

      await verifyJwt(request, reply)

      expect((request as any).jwtClaims).toEqual(validResult)
    })

    it('chama jwt.validate com o token extraído do header', async () => {
      jwtMock.validate.mockResolvedValue(validResult)
      const reply = makeReply()

      await verifyJwt(makeRequest('Bearer meu-token-jwt'), reply)

      expect(jwtMock.validate).toHaveBeenCalledWith('meu-token-jwt')
    })
  })
})
