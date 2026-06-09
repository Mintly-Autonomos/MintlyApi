import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { UnauthorizedError } from '../../core/errors/auth/unauthorized-error'

import { buildServer } from '../../infrastructure/server/build-server'

const mockExecute = vi.hoisted(() => vi.fn())
const mockLogin = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockLogout = vi.hoisted(() => vi.fn())

vi.mock('./use-cases/register-use-case', () => ({
  RegisterUseCase: class { execute = mockExecute },
}))

vi.mock('./use-cases/auth-use-case', () => ({
  AuthUseCase: class {
    login = mockLogin
    refresh = mockRefresh
    logout = mockLogout
  },
}))

const SIGNUP_BODY = {
  person: { name: 'João Silva', phone: '11999990000' },
  email: 'joao@restaurante.com',
  password: 'Senha123',
  restaurantName: 'Restaurante do João',
  termsAccepted: true,
}

const SIGNUP_RESULT = {
  accessToken: 'mock-access',
  refreshToken: 'mock-refresh',
  user: { email: 'joao@restaurante.com', person: { name: 'João Silva' } },
  restaurant: { name: 'Restaurante do João' },
}

describe('Auth Routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    server = await buildServer()
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /auth/signup', () => {
    it('retorna 201 com payload contendo tokens, user e restaurant', async () => {
      mockExecute.mockResolvedValue(SIGNUP_RESULT)
      const res = await server.inject({ method: 'POST', url: '/auth/signup', payload: SIGNUP_BODY })
      expect(res.statusCode).toBe(201)
      expect(res.json().payload.accessToken).toBe('mock-access')
      expect(res.json().payload.restaurant.name).toBe('Restaurante do João')
    })

    it('retorna 400 VALIDATION_ERROR para SapphireValidationError', async () => {
      mockExecute.mockRejectedValue(
        new SapphireValidationError([{ path: ['email'], code: 'format', message: 'E-mail inválido.' }]),
      )
      const res = await server.inject({ method: 'POST', url: '/auth/signup', payload: SIGNUP_BODY })
      expect(res.statusCode).toBe(400)
      expect(res.json().code).toBe('VALIDATION_ERROR')
    })

    it('retorna 409 quando o e-mail já está cadastrado', async () => {
      mockExecute.mockRejectedValue(new ConflictError('Este e-mail já está cadastrado.'))
      const res = await server.inject({ method: 'POST', url: '/auth/signup', payload: SIGNUP_BODY })
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('AUTH-0002')
    })
  })

  describe('POST /auth/login', () => {
    it('retorna 200 com payload', async () => {
      mockLogin.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', user: { email: 'x' } })
      const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@x.com', password: 'Senha123' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.accessToken).toBe('a')
    })

    it('retorna 401 para credenciais inválidas', async () => {
      mockLogin.mockRejectedValue(new UnauthorizedError('Credenciais inválidas'))
      const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@x.com', password: 'z' } })
      expect(res.statusCode).toBe(401)
      expect(res.json().code).toBe('AUTH-0001')
    })
  })

  describe('POST /auth/refresh', () => {
    it('retorna 200 com novos tokens no payload', async () => {
      mockRefresh.mockResolvedValue({ accessToken: 'na', refreshToken: 'nr' })
      const res = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: 'valid' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().payload.accessToken).toBe('na')
    })
  })

  describe('POST /auth/logout', () => {
    it('retorna 204', async () => {
      mockLogout.mockResolvedValue(undefined)
      const res = await server.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: 'rt' } })
      expect(res.statusCode).toBe(204)
    })
  })

  describe('rotas registradas', () => {
    it('registra /auth/* no swagger', () => {
      const swagger = server.swagger() as { paths?: Record<string, unknown> }
      const authPaths = Object.keys(swagger.paths ?? {}).filter(p => p.startsWith('/auth'))
      expect(authPaths.length).toBeGreaterThan(0)
    })
  })
})
