import { describe, expect, it } from 'vitest'
import { CategoryType, DreGroup } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'
import { SYSTEM_CATEGORY_DRE_GROUPS, resolveCategoryUpdate, resolveInsertDreGroup } from './category-rules'

describe('resolveInsertDreGroup', () => {
  it('despesa sem grupo recebe opex', () => {
    expect(resolveInsertDreGroup({ name: 'Gás', type: CategoryType.Expense })).toEqual({ name: 'Gás', type: CategoryType.Expense, dreGroup: DreGroup.Opex })
  })

  it('despesa com grupo mantém', () => {
    expect(resolveInsertDreGroup({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }).dreGroup).toBe(DreGroup.Cmv)
  })

  it('receita com grupo é recusada', () => {
    expect(() => resolveInsertDreGroup({ type: CategoryType.Revenue, dreGroup: DreGroup.Opex })).toThrow(ValidationError)
  })

  it('receita sem grupo passa intacta', () => {
    expect(resolveInsertDreGroup({ type: CategoryType.Revenue })).toEqual({ type: CategoryType.Revenue })
  })
})

describe('resolveCategoryUpdate', () => {
  it('despesa: mantém o grupo gravado quando a edição não fala dele', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { name: 'Insumos' }))
      .toEqual({ set: { name: 'Insumos', dreGroup: DreGroup.Cmv }, unsetDreGroup: false })
  })

  it('despesa: troca o grupo quando enviado', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { dreGroup: DreGroup.Labor }).set.dreGroup).toBe(DreGroup.Labor)
  })

  it('despesa sem grupo gravado (antes do backfill): completa com opex', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense }, { name: 'X' }).set.dreGroup).toBe(DreGroup.Opex)
  })

  it('receita → despesa: ganha opex', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Revenue }, { type: CategoryType.Expense }))
      .toEqual({ set: { type: CategoryType.Expense, dreGroup: DreGroup.Opex }, unsetDreGroup: false })
  })

  it('despesa → receita: remove o grupo', () => {
    expect(resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { type: CategoryType.Revenue }))
      .toEqual({ set: { type: CategoryType.Revenue }, unsetDreGroup: true })
  })

  it('receita com grupo enviado é recusada', () => {
    expect(() => resolveCategoryUpdate({ type: CategoryType.Revenue }, { dreGroup: DreGroup.Opex })).toThrow(ValidationError)
    expect(() => resolveCategoryUpdate({ type: CategoryType.Expense, dreGroup: DreGroup.Cmv }, { type: CategoryType.Revenue, dreGroup: DreGroup.Opex })).toThrow(ValidationError)
  })
})

describe('SYSTEM_CATEGORY_DRE_GROUPS', () => {
  it('mapeia as despesas de sistema do onboarding', () => {
    expect(SYSTEM_CATEGORY_DRE_GROUPS).toEqual({
      'CMV/Insumos': DreGroup.Cmv,
      Salários: DreGroup.Labor,
      Aluguel: DreGroup.Opex,
      Impostos: DreGroup.Tax,
    })
  })
})
