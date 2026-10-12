import { CategoryType, DreGroup } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'

/**
 * Regras do dreGroup na categoria (M2) — puras, no padrão do `account-rules.ts`.
 * A união da lib impõe "despesa tem grupo, receita não" no documento; aqui mora
 * o que depende do estado gravado (PATCH parcial) e o padrão `opex` no cadastro,
 * que mantém o formulário atual do front funcionando.
 */

/** Grupo das despesas de sistema criadas no onboarding — usado também no backfill. */
export const SYSTEM_CATEGORY_DRE_GROUPS: Record<string, DreGroup> = {
  'CMV/Insumos': DreGroup.Cmv,
  Salários: DreGroup.Labor,
  Aluguel: DreGroup.Opex,
  Impostos: DreGroup.Tax,
}

const REVENUE_WITH_GROUP = 'Categoria de receita não tem dreGroup: a classificação contábil é só de despesa.'

export function resolveInsertDreGroup<T extends { type?: string; dreGroup?: string }> (item: T): T {
  if (item.type === CategoryType.Revenue && item.dreGroup !== undefined) {
    throw new ValidationError(REVENUE_WITH_GROUP)
  }
  if (item.type === CategoryType.Expense) {
    return { ...item, dreGroup: item.dreGroup ?? DreGroup.Opex }
  }
  return item
}

export function resolveCategoryUpdate (
  stored: { type: string; dreGroup?: string },
  changes: { type?: string; dreGroup?: string } & Record<string, unknown>,
): { set: Record<string, unknown>; unsetDreGroup: boolean } {
  const finalType = changes.type ?? stored.type

  if (finalType === CategoryType.Revenue) {
    if (changes.dreGroup !== undefined) throw new ValidationError(REVENUE_WITH_GROUP)
    return { set: { ...changes }, unsetDreGroup: stored.dreGroup !== undefined }
  }

  return {
    set: { ...changes, dreGroup: changes.dreGroup ?? stored.dreGroup ?? DreGroup.Opex },
    unsetDreGroup: false,
  }
}
