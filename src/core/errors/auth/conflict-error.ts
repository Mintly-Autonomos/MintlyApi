import { BaseError } from '../core/base-error'

export class ConflictError extends BaseError {
  constructor (message = 'Recurso já existe') {
    super(message, message, 'AUTH-0002', 409)
  }
}
