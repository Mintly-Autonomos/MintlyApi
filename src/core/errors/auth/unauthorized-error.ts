import { BaseError } from '../core/base-error'

export class UnauthorizedError extends BaseError {
  constructor (message = 'Credenciais inválidas ou token expirado') {
    super(message, message, 'AUTH-0001', 401)
  }
}
