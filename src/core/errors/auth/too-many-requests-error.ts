import { BaseError } from '../core/base-error'

export class TooManyRequestsError extends BaseError {
  constructor (message = 'Muitas tentativas. Tente novamente mais tarde.') {
    super(message, message, 'AUTH-0004', 429)
  }
}
