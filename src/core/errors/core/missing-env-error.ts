import { BaseError } from './base-error'
import { errorGlossary } from './error-glossary'

/**
 * Header `env` obrigatório ausente. O `env` roteia a requisição para o banco do
 * tenant (getDatabase(env)); sem ele, cair num default silencioso mascara erros
 * de configuração e grava dados no banco errado. 400 (requisição malformada).
 */
export class MissingEnvError extends BaseError {
  constructor () {
    super(
      errorGlossary.missingEnv.message,
      errorGlossary.missingEnv.apiMessage,
      errorGlossary.missingEnv.code,
      400,
    )
  }
}
