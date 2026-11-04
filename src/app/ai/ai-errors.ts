import { BaseError } from '../../core/errors/core/base-error'

/** 429: o restaurante usou todas as chamadas à IA de hoje. O front mantém os textos de sempre. */
export class AiLimitReachedError extends BaseError {
  constructor (limit: number) {
    const message = `Você já usou as ${limit} sugestões da IA de hoje. Elas voltam amanhã; enquanto isso, os textos de sempre continuam na tela.`
    super(message, message, 'AI-0001', 429)
  }
}

/** 503: a IA não respondeu como esperado (sem chave configurada, fora do ar, demorou, recusou). O front mantém os textos de sempre. */
export class AiUnavailableError extends BaseError {
  constructor (message = 'A IA não está disponível agora. Tente de novo em instantes.') {
    super(message, message, 'AI-0002', 503)
  }
}
