import { BaseError } from './base-error'
import { errorGlossary } from './error-glossary'

/**
 * 400 de regra de negócio sobre o dado enviado (o que o schema não expressa —
 * ex.: data no futuro). Validação de FORMA continua no schema (Sapphire/Fastify).
 */
export class ValidationError extends BaseError {
  constructor (message: string) {
    super(message, message, errorGlossary.validation.code, 400)
  }
}
