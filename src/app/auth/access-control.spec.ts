import { describe, expect, it } from 'vitest'
import { MemberProfile } from 'mintly-lib'
import { accessDenial, assertPersonnelAllowed, hidesPersonnel, isPersonnelCategory, PERSONNEL_DENIED, REPORTS_DENIED, SETUP_DENIED } from './access-control'

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
    for (const [m, u] of [['POST', '/financial-accounts'], ['PUT', '/financial-accounts/1/opening-balance'], ['PATCH', '/financial-categories/1'], ['POST', '/menu-items/1/price-review'], ['POST', '/financial-movements/recompute-balances']]) {
      expect(accessDenial(OP, m, u)).toBe(SETUP_DENIED)
    }
  })

  it('Operação: movimentações, transferência, conta e restaurante passam; prefixo parecido não confunde', () => {
    for (const [m, u] of [['POST', '/financial-movements'], ['PATCH', '/financial-movements/1'], ['POST', '/financial-movements/transfers'], ['GET', '/restaurants/me'], ['GET', '/reportsx']]) {
      expect(accessDenial(OP, m, u)).toBeNull()
    }
  })

  it('dono e Gerente passam em tudo', () => {
    for (const level of ['owner', MemberProfile.Manager] as const) {
      expect(accessDenial(level, 'GET', '/reports/result')).toBeNull()
      expect(accessDenial(level, 'POST', '/financial-accounts')).toBeNull()
    }
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
