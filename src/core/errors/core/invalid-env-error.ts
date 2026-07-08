import { BaseError } from './base-error'
import { errorGlossary } from './error-glossary'

/**
 * Header `env` presente mas fora da allowlist (app.valid_environments). O front
 * só deve mandar ambientes conhecidos (ex.: staging/production); qualquer outro
 * valor é requisição malformada do cliente. 400. Ver env-allowlist.ts.
 */
export class InvalidEnvError extends BaseError {
  constructor (env: string) {
    super(
      errorGlossary.invalidEnv.message + ` Recebido: "${env}".`,
      errorGlossary.invalidEnv.apiMessage,
      errorGlossary.invalidEnv.code,
      400,
    )
  }
}
