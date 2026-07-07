import { BaseError } from '../core/base-error'
import { errorGlossary } from '../core/error-glossary'

export class ConflictError extends BaseError {
  constructor (message = 'Recurso já existe') {
    super(message, message, errorGlossary.conflict.code, 409)
  }
}
