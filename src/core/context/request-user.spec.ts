import { describe, it, expect } from 'vitest'
import { getRequestUser } from './request-user'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

/** Claims no formato REAL do Valkyrie: cada valor é uma lista. */
const claimsDoValkyrie = (over: Record<string, unknown> = {}) => ({
  name: ['João'],
  email: ['joao@x.com'],
  restaurantId: ['r1'],
  role: ['owner'],
  status: ['active'],
  ...over,
})
const requestCom = (claims: Record<string, unknown>, subject: string | null = 'u1') =>
  ({ jwtClaims: { subject, claims } }) as any

describe('getRequestUser', () => {
  it('extrai o primeiro valor de cada claim (o Valkyrie devolve listas) e tipa o usuário', () => {
    const user = getRequestUser(requestCom(claimsDoValkyrie({ cpf: ['123'] })))
    expect(user).toEqual({
      userId: 'u1', name: 'João', email: 'joao@x.com', cpf: '123', restaurantId: 'r1', role: 'owner', status: 'active',
    })
    // o ponto do bug: papel e nome são TEXTO, não lista (comparações como role === 'owner' funcionam)
    expect(typeof user.role).toBe('string')
    expect(user.role === 'owner').toBe(true)
  })

  it('funcionário: role member', () => {
    expect(getRequestUser(requestCom(claimsDoValkyrie({ role: ['member'] }))).role).toBe('member')
  })

  it('também aceita claims em texto puro', () => {
    const user = getRequestUser(requestCom({ name: 'Ana', email: 'ana@x.com', restaurantId: 'r2', role: 'member', status: 'active' }))
    expect(user).toMatchObject({ name: 'Ana', restaurantId: 'r2', role: 'member' })
  })

  it('cpf é opcional (o token não o grava hoje)', () => {
    expect(getRequestUser(requestCom(claimsDoValkyrie())).cpf).toBeUndefined()
  })

  it('só o primeiro valor conta quando o claim traz vários', () => {
    expect(getRequestUser(requestCom(claimsDoValkyrie({ role: ['member', 'owner'] }))).role).toBe('member')
  })

  it('lança UnauthorizedError quando o hook não anexou os claims', () => {
    expect(() => getRequestUser({} as any)).toThrow(UnauthorizedError)
    expect(() => getRequestUser({ jwtClaims: { subject: 'u1' } } as any)).toThrow(UnauthorizedError)
    expect(() => getRequestUser(requestCom(claimsDoValkyrie(), null))).toThrow(UnauthorizedError)
  })

  it.each(['name', 'email', 'restaurantId', 'role', 'status'])('sem o claim %s: UnauthorizedError (nada de undefined passando como usuário)', (campo) => {
    expect(() => getRequestUser(requestCom(claimsDoValkyrie({ [campo]: undefined })))).toThrow(UnauthorizedError)
    expect(() => getRequestUser(requestCom(claimsDoValkyrie({ [campo]: [] })))).toThrow(UnauthorizedError)
    expect(() => getRequestUser(requestCom(claimsDoValkyrie({ [campo]: [''] })))).toThrow(UnauthorizedError)
  })

  it('papel ou status fora dos valores conhecidos: UnauthorizedError', () => {
    expect(() => getRequestUser(requestCom(claimsDoValkyrie({ role: ['admin'] })))).toThrow(UnauthorizedError)
    expect(() => getRequestUser(requestCom(claimsDoValkyrie({ status: ['talvez'] })))).toThrow(UnauthorizedError)
  })
})
