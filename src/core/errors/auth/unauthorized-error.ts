import { BaseError } from '../core/base-error'
import { errorGlossary } from '../core/error-glossary'

export class UnauthorizedError extends BaseError {
  constructor (message = errorGlossary.unauthorized.message) {
    super(message, message, errorGlossary.unauthorized.code, 401)
  }
}
