import { BaseError } from './base-error'

export class ValidationError extends BaseError {
  constructor (message: string) {
    super(message, 'Validation failed', 'VALIDATION_ERROR', 400)
  }
}
