import { StatusCodes } from 'http-status-codes'
import { BaseError } from './base-error'
import { errorGlossary } from './error-glossary'
import type { QueryKind } from '../../crud/query'

export class UnsupportedQueryKindError extends BaseError {
  constructor (kind: QueryKind, backend: string) {
    super(
      errorGlossary.unsupportedQueryKind.message + ` Kind: "${kind}", backend: "${backend}".`,
      errorGlossary.unsupportedQueryKind.apiMessage + ` Kind: "${kind}", backend: "${backend}".`,
      errorGlossary.unsupportedQueryKind.code,
      StatusCodes.NOT_IMPLEMENTED,
    )
  }
}
