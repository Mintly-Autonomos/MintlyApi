import { BaseError } from '../core/base-error'
import { errorGlossary } from '../core/error-glossary'

/**
 * 402 Payment Required: a conta existe, mas não há assinatura válida. O front, ao receber este
 * código em qualquer rota, leva a pessoa para a tela de assinatura.
 */
export class SubscriptionRequiredError extends BaseError {
  constructor (message = 'Assinatura necessária para usar o Mintly. Escolha um plano para continuar.') {
    super(message, message, errorGlossary.subscriptionRequired.code, 402)
  }
}
