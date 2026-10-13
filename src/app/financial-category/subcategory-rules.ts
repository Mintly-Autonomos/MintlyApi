import { Subcategory } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ValidationError } from '../../core/errors/core/validation-error'

/** Regras do sub-recurso de subcategorias (M4, fatia 5) — puras. */
export const SUBCATEGORY_NAME_MAX = 60

const key = (name: string) => name.trim().toLocaleLowerCase('pt-BR')

export function normalizeSubcategoryName (name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('Nome da subcategoria é obrigatório.')
  const trimmed = name.trim()
  if (trimmed.length > SUBCATEGORY_NAME_MAX) throw new ValidationError(`Nome da subcategoria tem no máximo ${SUBCATEGORY_NAME_MAX} caracteres.`)
  return trimmed
}

/** Único na categoria, sem diferenciar maiúsculas, contando as inativas (nada é apagado). */
export function assertUniqueSubcategoryName (existing: Subcategory[] | undefined, name: string, ignoreId?: string): void {
  const taken = (existing ?? []).some((s) => s._id !== ignoreId && key(s.name) === key(name))
  if (taken) throw new ConflictError('Já existe uma subcategoria com este nome nesta categoria.')
}

export function findSubcategory (category: { subcategories?: Subcategory[] }, id: string): Subcategory | undefined {
  return (category.subcategories ?? []).find((s) => s._id === id)
}
