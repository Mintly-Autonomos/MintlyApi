import { BaseError } from '../core/base-error'
import { errorGlossary } from '../core/error-glossary'

export class TooManyRequestsError extends BaseError {
  constructor (message = 'Muitas tentativas. Tente novamente mais tarde.') {
    super(message, message, errorGlossary.tooManyRequests.code, 429)
  }
}
