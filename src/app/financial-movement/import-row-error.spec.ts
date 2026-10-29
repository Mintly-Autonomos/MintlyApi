import { describe, expect, it } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { toImportRowError } from './import-row-error'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'

describe('toImportRowError', () => {
  it('erro de schema vira VALIDATION_ERROR citando o campo', () => {
    const err = new SapphireValidationError([{ path: ['date'], message: 'Data inválida' } as any])
    const out = toImportRowError(err)
    expect(out.code).toBe('VALIDATION_ERROR')
    expect(out.message).toContain('date')
  })

  it('409 de duplicidade vira DUPLICATE', () => {
    const out = toImportRowError(new ConflictError('Possível movimentação duplicada nos últimos 2 minutos.'))
    expect(out.code).toBe('DUPLICATE')
  })

  it('outro 409 vira CONFLICT mantendo a mensagem', () => {
    const out = toImportRowError(new ConflictError('Conta inativa não pode receber lançamentos financeiros.'))
    expect(out).toEqual({ code: 'CONFLICT', message: 'Conta inativa não pode receber lançamentos financeiros.' })
  })

  it('404 vira NOT_FOUND', () => {
    expect(toImportRowError(new NotFoundError(Resource.FinancialAccount, 'x')).code).toBe('NOT_FOUND')
  })

  it('erro desconhecido não vaza detalhe interno', () => {
    const out = toImportRowError(new Error('connection string mongodb://user:pass@host'))
    expect(out).toEqual({ code: 'INTERNAL_ERROR', message: 'Falha ao gravar a linha.' })
  })
})
