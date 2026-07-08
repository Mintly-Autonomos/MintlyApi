import { BaseError } from '../core/base-error'
import { errorGlossary } from '../core/error-glossary'

export class ForbiddenError extends BaseError {
  constructor (message = 'Acesso negado') {
    super(message, message, errorGlossary.forbidden.code, 403)
  }
}
