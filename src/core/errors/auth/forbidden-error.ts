import { BaseError } from '../core/base-error'

export class ForbiddenError extends BaseError {
  constructor (message = 'Acesso negado') {
    super(message, message, 'AUTH-0003', 403)
  }
}
