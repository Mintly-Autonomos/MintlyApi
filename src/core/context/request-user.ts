import type { FastifyRequest } from 'fastify'
import { UserRole, UserStatus } from 'mintly-lib'
import { UnauthorizedError } from '../errors/auth/unauthorized-error'

export interface RequestUser {
  userId: string
  name: string
  email: string
  cpf?: string
  restaurantId: string
  role: UserRole
  status: UserStatus
}

/**
 * Claims como o `verify-jwt` os anexa ao request: o ValkyrieJwtService devolve CADA claim como `string[]`
 * (ex.: `role: ['owner']`). Texto puro também é aceito, por tolerância.
 */
type RawClaims = Record<string, string | string[] | undefined>

/** Primeiro valor (texto não vazio) de um claim, ou `undefined`. */
function claim (claims: RawClaims, key: string): string | undefined {
  const value = claims[key]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first !== '' ? first : undefined
}

/**
 * Extrai e tipifica os claims do JWT descriptografado pelo verify-jwt hook.
 * Lança UnauthorizedError se o hook não foi executado (rota sem proteção) ou se o token não traz os dados
 * do usuário (nome, e-mail, restaurante, papel e status; o login e o cadastro sempre os gravam).
 *
 * Atenção: `role` e `status` são uma FOTO do momento do login (o token vale até 15 min e a renovação não os
 * relê do banco). Para decidir permissão (ex.: "só o dono"), leia o usuário do banco, como `requireOwner` faz.
 * `cpf` não é gravado no token hoje, então costuma vir `undefined`.
 */
export function getRequestUser (request: FastifyRequest): RequestUser {
  const jwt = (request as any).jwtClaims as { subject?: string, claims?: RawClaims } | undefined
  if (!jwt?.subject || !jwt.claims) throw new UnauthorizedError('Token não fornecido')

  const name = claim(jwt.claims, 'name')
  const email = claim(jwt.claims, 'email')
  const restaurantId = claim(jwt.claims, 'restaurantId')
  const role = claim(jwt.claims, 'role')
  const status = claim(jwt.claims, 'status')
  if (
    !name || !email || !restaurantId ||
    !role || !(Object.values(UserRole) as string[]).includes(role) ||
    !status || !(Object.values(UserStatus) as string[]).includes(status)
  ) {
    throw new UnauthorizedError('Token inválido: faltam dados do usuário. Faça login novamente.')
  }

  return {
    userId: jwt.subject,
    name,
    email,
    cpf: claim(jwt.claims, 'cpf'),
    restaurantId,
    role: role as UserRole,
    status: status as UserStatus,
  }
}
