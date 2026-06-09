import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyJwt } from './verify-jwt'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'
import * as jwtModule from '../../infrastructure/jwt/jwt-service'

vi.mock('../../infrastructure/jwt/jwt-service')

function makeRequest (authorization?: string): any {
  return { headers: authorization ? { authorization } : {} }
}

describe('verifyJwt', () => {
  let validate: any

  beforeEach(() => {
    vi.clearAllMocks()
    validate = vi.fn()
    vi.spyOn(jwtModule, 'getJwtService').mockReturnValue({ validate } as any)
  })

  describe('Authorization ausente ou malformado', () => {
    it('lança UnauthorizedError quando não há header', async () => {
      await expect(verifyJwt(makeRequest())).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('lança UnauthorizedError quando não começa com Bearer', async () => {
      await expect(verifyJwt(makeRequest('Basic dХk='))).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('não chama validate quando não há token', async () => {
      await verifyJwt(makeRequest()).catch(() => null)
      expect(validate).not.toHaveBeenCalled()
    })
  })

  describe('token inválido', () => {
    it('lança UnauthorizedError', async () => {
      validate.mockResolvedValue({ succeeded: false, failureReason: 'Token expirado' })
      await expect(verifyJwt(makeRequest('Bearer token-invalido'))).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })

  describe('token válido', () => {
    const valid = { succeeded: true, failureReason: null, subject: 'user-123', claims: { name: 'João' } }

    it('não lança e anexa jwtClaims ao request', async () => {
      validate.mockResolvedValue(valid)
      const request = makeRequest('Bearer valid-token')
      await verifyJwt(request)
      expect(request.jwtClaims).toEqual(valid)
    })

    it('valida com o token extraído do header', async () => {
      validate.mockResolvedValue(valid)
      await verifyJwt(makeRequest('Bearer meu-token-jwt'))
      expect(validate).toHaveBeenCalledWith('meu-token-jwt')
    })
  })
})
