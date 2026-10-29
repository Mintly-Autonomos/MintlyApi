import { BaseError } from '../../core/errors/core/base-error'

export interface ImportRowError {
  code: string
  message: string
}

/** Valida/lê o erro de schema do Sapphire (a lib é outro build do pacote: confere pelo nome). */
function validationFields (err: unknown): string[] | null {
  const e = err as { name?: string, flatten?: () => { fieldErrors?: Record<string, string[]> } }
  if (e?.name !== 'SapphireValidationError' || typeof e.flatten !== 'function') return null
  const fields = e.flatten().fieldErrors ?? {}
  return Object.entries(fields).map(([campo, msgs]) => `${campo}: ${(msgs ?? []).join(', ')}`)
}

/**
 * Traduz o que o `register` lançou em { code, message } para a linha, em português e sem vazar
 * detalhe interno. O `code` é estável: o front decide o que mostrar por ele.
 */
export function toImportRowError (err: unknown): ImportRowError {
  const campos = validationFields(err)
  if (campos) {
    return {
      code: 'VALIDATION_ERROR',
      message: campos.length ? `Dados inválidos (${campos.join('; ')}).` : 'Dados inválidos.',
    }
  }

  if (err instanceof BaseError) {
    if (err.statusCode === 409 && /duplicad/i.test(err.apiMessage)) {
      return { code: 'DUPLICATE', message: 'Possível duplicata: já existe um lançamento igual há menos de 2 minutos.' }
    }
    if (err.statusCode === 409) return { code: 'CONFLICT', message: err.apiMessage }
    if (err.statusCode === 404) return { code: 'NOT_FOUND', message: 'Conta ou categoria não encontrada neste restaurante.' }
    return { code: err.code, message: err.apiMessage }
  }

  return { code: 'INTERNAL_ERROR', message: 'Falha ao gravar a linha.' }
}
