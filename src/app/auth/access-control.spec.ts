import { describe, expect, it } from 'vitest'
import { MemberProfile } from 'mintly-lib'
import { accessDenial, assertCategoryAllowed, assertOwnCurrentMovement, assertPersonnelAllowed, CLOSED_MONTH_DENIED, hidesPersonnel, isPersonnelCategory, NON_OPERATING_DENIED, NOT_OWN_MOVEMENT_DENIED, PERSONNEL_DENIED, REPORTS_DENIED, SETUP_DENIED, TRANSFER_DENIED } from './access-control'

const OP = MemberProfile.Operations

describe('accessDenial (E.3)', () => {
  it('Operação: relatórios, painel e IA fechados (com query e barra no fim)', () => {
    for (const url of ['/reports/result?month=2026-11', '/reports/expenses', '/dashboard/overview', '/ai/insights', '/reports/']) {
      expect(accessDenial(OP, 'GET', url)).toBe(REPORTS_DENIED)
    }
  })

  it('Operação: lê cadastros, mas não escreve; o recálculo de saldo também é cadastro', () => {
    expect(accessDenial(OP, 'GET', '/financial-accounts')).toBeNull()
    expect(accessDenial(OP, 'GET', '/menu-items/price-alerts')).toBeNull()
    // Perfis de venda por categoria: Operação lê (o simulador usa), mas não troca.
    expect(accessDenial(OP, 'GET', '/menu-items/category-profiles')).toBeNull()
    expect(accessDenial(OP, 'PUT', '/menu-items/category-profiles')).toBe(SETUP_DENIED)
    for (const [m, u] of [['POST', '/financial-accounts'], ['PUT', '/financial-accounts/1/opening-balance'], ['PATCH', '/financial-categories/1'], ['POST', '/menu-items/1/price-review'], ['POST', '/financial-movements/recompute-balances']]) {
      expect(accessDenial(OP, m, u)).toBe(SETUP_DENIED)
    }
  })

  it('Operação: movimentações, conta e restaurante passam; prefixo parecido não confunde', () => {
    for (const [m, u] of [['POST', '/financial-movements'], ['PATCH', '/financial-movements/1'], ['GET', '/restaurants/me'], ['GET', '/reportsx']]) {
      expect(accessDenial(OP, m, u)).toBeNull()
    }
  })

  it('Operação não transfere entre contas (problemas 23/11); dono e Gerente transferem', () => {
    expect(accessDenial(OP, 'POST', '/financial-movements/transfers')).toBe(TRANSFER_DENIED)
    expect(accessDenial(MemberProfile.Manager, 'POST', '/financial-movements/transfers')).toBeNull()
    expect(accessDenial('owner', 'POST', '/financial-movements/transfers')).toBeNull()
  })

  it('dono e Gerente passam em tudo', () => {
    for (const level of ['owner', MemberProfile.Manager] as const) {
      expect(accessDenial(level, 'GET', '/reports/result')).toBeNull()
      expect(accessDenial(level, 'POST', '/financial-accounts')).toBeNull()
    }
  })
})

describe('Operação: categoria não operacional e só o próprio lançamento do mês (problemas 23/11)', () => {
  const op = { env: 'x', accessLevel: OP, userId: 'u-op' } as const
  const ger = { env: 'x', accessLevel: MemberProfile.Manager, userId: 'u-ger' } as const
  const monthOf = (d: Date) => d.toISOString().slice(0, 7)

  it('categoria não operacional é recusada só para Operação (a do sistema não conta)', () => {
    expect(() => assertCategoryAllowed(op, { operationalNature: 'nonOperational' })).toThrow(NON_OPERATING_DENIED)
    expect(() => assertCategoryAllowed(op, { operationalNature: 'operational' })).not.toThrow()
    expect(() => assertCategoryAllowed(op, { operationalNature: 'nonOperational', systemKey: 'transferIn' })).not.toThrow()
    expect(() => assertCategoryAllowed(ger, { operationalNature: 'nonOperational' })).not.toThrow()
    expect(() => assertCategoryAllowed(op, { dreGroup: 'labor' })).toThrow(PERSONNEL_DENIED)
  })

  it('Operação só altera o que ela lançou, no mês atual (e não leva para outro mês)', () => {
    const p = { currentMonth: '2026-11', monthOf }
    const meu = { audit: { createdBy: 'u-op' }, date: new Date('2026-11-10T15:00:00Z') }
    expect(() => assertOwnCurrentMovement(op, meu, p)).not.toThrow()
    expect(() => assertOwnCurrentMovement(op, { ...meu, audit: { createdBy: 'dona' } }, p)).toThrow(NOT_OWN_MOVEMENT_DENIED)
    expect(() => assertOwnCurrentMovement(op, { ...meu, date: new Date('2026-10-30T15:00:00Z') }, p)).toThrow(CLOSED_MONTH_DENIED)
    expect(() => assertOwnCurrentMovement(op, meu, { ...p, newDate: new Date('2026-10-30T15:00:00Z') })).toThrow(CLOSED_MONTH_DENIED)
    expect(() => assertOwnCurrentMovement(ger, { audit: { createdBy: 'dona' }, date: new Date('2025-01-01') }, p)).not.toThrow()
  })
})

describe('pessoal (E.3)', () => {
  it('categoria de pessoal é a do grupo labor', () => {
    expect(isPersonnelCategory({ dreGroup: 'labor' })).toBe(true)
    expect(isPersonnelCategory({ dreGroup: 'opex' })).toBe(false)
    expect(isPersonnelCategory(null)).toBe(false)
  })

  it('só Operação esconde e recusa pessoal; sem nível (rota interna) nada muda', () => {
    expect(hidesPersonnel({ env: 'x', accessLevel: OP })).toBe(true)
    expect(hidesPersonnel({ env: 'x', accessLevel: MemberProfile.Manager })).toBe(false)
    expect(hidesPersonnel({ env: 'x' })).toBe(false)
    expect(() => assertPersonnelAllowed({ env: 'x', accessLevel: OP }, { dreGroup: 'cmv' }, { dreGroup: 'labor' })).toThrow(PERSONNEL_DENIED)
    expect(() => assertPersonnelAllowed({ env: 'x', accessLevel: 'owner' }, { dreGroup: 'labor' })).not.toThrow()
  })
})
