import type { FastifyRequest } from 'fastify'
import type { ClientSession, Db } from 'mongodb'
import { accessLevelOf, canManageSetup, canSeePersonnel, canViewReports, DreGroup, MEMBER_PROFILE_LABEL, MemberProfile, OperationalNature, UserRole } from 'mintly-lib'
import type { AccessLevel } from 'mintly-lib'
import { buildRequestContext } from '../../core/context/build-request-context'
import { RequestContext } from '../../core/context/request-context'
import { ForbiddenError } from '../../core/errors/auth/forbidden-error'
import { UnauthorizedError } from '../../core/errors/auth/unauthorized-error'
import { AuthRepository } from './auth-repository'

/**
 * Perfis de funcionário (relatório Sweetie Bel, E.3). A regra fica aqui, na API: a tela só esconde o que a
 * API já recusa.
 *
 * - Operação: sem relatórios (`/reports`, `/dashboard`, `/ai`), sem mudar cadastros (contas, categorias,
 *   cardápio, saldo inicial, recálculo de saldo) e sem movimentações de pessoal (categorias `labor`).
 * - Gerente: tudo o que o dono faz, menos o que já é só do dono (`requireOwner`).
 */

export const REPORTS_DENIED = `Seu perfil (${MEMBER_PROFILE_LABEL[MemberProfile.Operations]}) não tem acesso aos relatórios.`
export const SETUP_DENIED = `Seu perfil (${MEMBER_PROFILE_LABEL[MemberProfile.Operations]}) não muda cadastros: contas, categorias e cardápio ficam com o dono ou o gerente.`
export const PERSONNEL_DENIED = `Seu perfil (${MEMBER_PROFILE_LABEL[MemberProfile.Operations]}) não vê nem lança movimentações de mão de obra (salários, pró-labore, encargos e freelancers).`
const OP = MEMBER_PROFILE_LABEL[MemberProfile.Operations]
/** Decisões do Nathan (problemas de 23/11). */
export const TRANSFER_DENIED = `Seu perfil (${OP}) não transfere entre contas: as contas ficam com o dono ou o gerente.`
export const NON_OPERATING_DENIED = `Seu perfil (${OP}) não lança em categorias não operacionais (aporte, empréstimo, equipamento): elas ficam com o dono ou o gerente.`
export const NOT_OWN_MOVEMENT_DENIED = `Seu perfil (${OP}) só altera os lançamentos que você mesmo fez.`
export const CLOSED_MONTH_DENIED = `Seu perfil (${OP}) só altera lançamentos do mês atual.`

const REPORT_PREFIXES = ['/reports', '/dashboard', '/ai']
const SETUP_PREFIXES = ['/financial-accounts', '/financial-categories', '/menu-items']
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const startsWithSegment = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/** Motivo da recusa para o perfil, ou `null` quando o pedido passa. Pura (testada sem servidor). */
export function accessDenial (level: AccessLevel, method: string, url: string): string | null {
  const path = url.split('?')[0].replace(/\/+$/, '') || '/'
  if (!canViewReports(level) && REPORT_PREFIXES.some((p) => startsWithSegment(path, p))) return REPORTS_DENIED
  if (!canManageSetup(level)) {
    const write = !READ_METHODS.has(method.toUpperCase())
    if (write && SETUP_PREFIXES.some((p) => startsWithSegment(path, p))) return SETUP_DENIED
    if (write && path === '/financial-movements/recompute-balances') return SETUP_DENIED
    if (write && path === '/financial-movements/transfers') return TRANSFER_DENIED
  }
  return null
}

/**
 * preHandler das rotas protegidas: descobre o nível de acesso de quem pede e recusa o que o perfil não pode.
 * O dono passa direto (o papel não muda). Para funcionário, o perfil e a situação são lidos do BANCO a cada
 * pedido: trocar o perfil ou inativar vale na hora, sem esperar o token vencer.
 */
export async function enforceAccessLevel (request: FastifyRequest): Promise<void> {
  const jwt = (request as any).jwtClaims as { subject?: string, claims?: Record<string, string | string[] | undefined> } | undefined
  const userId = jwt?.subject
  if (!userId) return // o verifyJwt já recusou quem não tem token
  const raw = jwt?.claims?.role
  const role = Array.isArray(raw) ? raw[0] : raw
  if (role === UserRole.Owner) {
    (request as any).accessLevel = 'owner'
    return
  }
  const ctx = buildRequestContext(request as any)
  const user = await new AuthRepository().findById(userId, ctx).catch(() => null)
  // Token sem papel e sem usuário (token de serviço ou de antes dos claims): segue como antes dos perfis.
  if (!user && role === undefined) return
  if (user?.role === UserRole.Owner) {
    (request as any).accessLevel = 'owner'
    return
  }
  if (!user || user.status !== 'active' || (ctx.restaurantId && user.restaurantId !== ctx.restaurantId)) {
    throw new UnauthorizedError('Seu acesso foi encerrado. Entre de novo ou fale com o dono do restaurante.')
  }
  const level = accessLevelOf(user as { role: string; memberProfile?: string })
  ;(request as any).accessLevel = level
  const denial = accessDenial(level, request.method, request.url)
  if (denial) throw new ForbiddenError(denial)
}

/** Quem pede não pode ver as movimentações de pessoal. */
export function hidesPersonnel (ctx: RequestContext): boolean {
  return ctx.accessLevel != null && !canSeePersonnel(ctx.accessLevel)
}

/** Categoria (documento ou snapshot) do grupo `labor`. */
export function isPersonnelCategory (category: Record<string, any> | null | undefined): boolean {
  return category?.dreGroup === DreGroup.Labor
}

/** Recusa (403) lançar ou mexer em movimentação de pessoal quando o perfil não pode. */
export function assertPersonnelAllowed (ctx: RequestContext, ...categories: Array<Record<string, any> | null | undefined>): void {
  if (hidesPersonnel(ctx) && categories.some(isPersonnelCategory)) throw new ForbiddenError(PERSONNEL_DENIED)
}

/** Perfil que só lança: não usa categoria não operacional e só altera o próprio lançamento do mês atual (Operação). */
export function isOperationsOnly (ctx: RequestContext): boolean {
  return ctx.accessLevel != null && !canManageSetup(ctx.accessLevel)
}

/** Recusa (403) lançar em categoria "Não operacional" (aporte do sócio, empréstimo) para o perfil Operação. */
export function assertCategoryAllowed (ctx: RequestContext, ...categories: Array<Record<string, any> | null | undefined>): void {
  assertPersonnelAllowed(ctx, ...categories)
  if (isOperationsOnly(ctx) && categories.some((c) => c?.operationalNature === OperationalNature.NonOperational && !c?.systemKey)) {
    throw new ForbiddenError(NON_OPERATING_DENIED)
  }
}

/**
 * O perfil Operação só edita, muda o status ou cancela o lançamento que ele mesmo fez e que é do mês atual (pela
 * data do lançamento, no fuso do restaurante). `currentMonth` e `monthOf` vêm de quem chama (período em São Paulo).
 */
export function assertOwnCurrentMovement (
  ctx: RequestContext,
  mov: Record<string, any>,
  p: { currentMonth: string, monthOf: (d: Date) => string, newDate?: Date | null },
): void {
  if (!isOperationsOnly(ctx)) return
  if (!ctx.userId || mov.audit?.createdBy !== ctx.userId) throw new ForbiddenError(NOT_OWN_MOVEMENT_DENIED)
  const dates = [mov.date ? new Date(mov.date) : null, p.newDate ?? null].filter((d): d is Date => d != null)
  if (dates.some((d) => p.monthOf(d) !== p.currentMonth)) throw new ForbiddenError(CLOSED_MONTH_DENIED)
}

/** Ids das categorias de pessoal do restaurante (para tirar da listagem). */
export async function personnelCategoryIds (db: Db, restaurantId: string, session?: ClientSession): Promise<string[]> {
  const docs = await db.collection('financial_categories')
    .find({ restaurantId, dreGroup: DreGroup.Labor }, { projection: { _id: 1 }, session })
    .toArray()
  return docs.map((d) => String(d._id))
}
