import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { UnauthorizedError } from '../../core/errors/auth/unauthorized-error'

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn())
const mockLogin   = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockLogout  = vi.hoisted(() => vi.fn())

vi.mock('./use-cases/register-use-case', () => ({
  RegisterUseCase: class { execute = mockExecute },
}))

vi.mock('./use-cases/auth-use-case', () => ({
  AuthUseCase: class {
    login   = mockLogin
    refresh = mockRefresh
    logout  = mockLogout
  },
}))

// ─── import APÓS os mocks ─────────────────────────────────────────────────────

import { buildServer } from '../../infrastructure/server/build-server'

// ─── dados de apoio ───────────────────────────────────────────────────────────

const REGISTER_BODY = {
  nome: 'João Silva',
  email: 'joao@restaurante.com',
  senha: 'Senha123',
  confirmarSenha: 'Senha123',
  nomeRestaurante: 'Restaurante do João',
  aceitouTermos: true,
  aceitouPrivacidade: true,
}

const REGISTER_RESULT = {
  accessToken: 'mock-access',
  refreshToken: 'mock-refresh',
  user: { nome: 'João Silva', email: 'joao@restaurante.com' },
  organization: { id: 'org-id', nome: 'Restaurante do João' },
}

const LOGIN_RESULT = {
  accessToken: 'mock-access',
  refreshToken: 'mock-refresh',
  user: { nome: 'João Silva', email: 'joao@restaurante.com' },
}

// ─── suite ───────────────────────────────────────────────────────────────────

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

  // ── POST /auth/register ───────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('retorna 201 com tokens e dados do usuário para cadastro válido', async () => {
      mockExecute.mockResolvedValue(REGISTER_RESULT)

      const response = await server.inject({
        method: 'POST',
        url: '/auth/register',
        payload: REGISTER_BODY,
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.accessToken).toBe('mock-access')
      expect(body.user.email).toBe('joao@restaurante.com')
      expect(body.organization.nome).toBe('Restaurante do João')
    })

    it('retorna 400 com code VALIDATION_ERROR para SapphireValidationError', async () => {
      mockExecute.mockRejectedValue(
        new SapphireValidationError([
          { path: ['email'], code: 'format', message: 'Informe um e-mail válido.' },
        ]),
      )

      const response = await server.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { ...REGISTER_BODY, email: 'invalido' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe('VALIDATION_ERROR')
    })

    it('retorna fieldErrors na resposta de erro de validação', async () => {
      mockExecute.mockRejectedValue(
        new SapphireValidationError([
          { path: ['confirmarSenha'], code: 'custom' as any, message: 'As senhas não conferem.' },
        ]),
      )

      const response = await server.inject({
        method: 'POST',
        url: '/auth/register',
        payload: REGISTER_BODY,
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().details).toBeDefined()
    })

    it('retorna 409 quando o e-mail já está cadastrado', async () => {
      mockExecute.mockRejectedValue(new ConflictError('Este e-mail já está cadastrado.'))

      const response = await server.inject({
        method: 'POST',
        url: '/auth/register',
        payload: REGISTER_BODY,
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('AUTH-0002')
    })
  })

  // ── POST /auth/login ──────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('retorna 200 com tokens para credenciais válidas', async () => {
      mockLogin.mockResolvedValue(LOGIN_RESULT)

      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'joao@restaurante.com', password: 'Senha123' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().accessToken).toBe('mock-access')
    })

    it('retorna 401 para credenciais inválidas', async () => {
      mockLogin.mockRejectedValue(new UnauthorizedError('Credenciais inválidas'))

      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'joao@restaurante.com', password: 'Errada1!' },
      })

      expect(response.statusCode).toBe(401)
      expect(response.json().code).toBe('AUTH-0001')
    })
  })

  // ── POST /auth/refresh ────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('retorna 200 com novos tokens para refresh token válido', async () => {
      mockRefresh.mockResolvedValue({ accessToken: 'novo-access', refreshToken: 'novo-refresh' })

      const response = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'valid-token' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().accessToken).toBe('novo-access')
    })

    it('retorna 401 para refresh token inválido', async () => {
      mockRefresh.mockRejectedValue(new UnauthorizedError('Token inválido'))

      const response = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'expired' },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  // ── POST /auth/logout ─────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('retorna 204 para logout bem-sucedido', async () => {
      mockLogout.mockResolvedValue(undefined)

      const response = await server.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: 'some-token' },
      })

      expect(response.statusCode).toBe(204)
    })
  })

  // ── registro de rotas ─────────────────────────────────────────────────────

  describe('rotas registradas', () => {
    it('registra /auth/* no swagger', () => {
      const swagger = server.swagger() as { paths?: Record<string, unknown> }
      const authPaths = Object.keys(swagger.paths ?? {}).filter(p => p.startsWith('/auth'))
      expect(authPaths.length).toBeGreaterThan(0)
    })
  })
})
