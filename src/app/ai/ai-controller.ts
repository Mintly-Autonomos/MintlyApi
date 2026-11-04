import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { AiInsightsUseCase } from './ai-insights-use-case'
import { AiPriceSuggestionUseCase } from './ai-price-suggestion-use-case'
import { AiRepository } from './ai-repository'

export class AiController {
  constructor (
    private readonly insights: AiInsightsUseCase = new AiInsightsUseCase(),
    private readonly price: AiPriceSuggestionUseCase = new AiPriceSuggestionUseCase(),
    private readonly repo: AiRepository = new AiRepository(),
  ) {}

  /** GET /ai/usage — quantas chamadas restam hoje. Não gasta chamada. */
  async usage (request: any, reply: any) {
    const payload = await this.repo.usage(buildRequestContext(request), new Date())
    return new ResponseBuilder().status(StatusCodes.OK).payload(payload).send(reply)
  }

  /** POST /ai/insights */
  async createInsights (request: any, reply: any) {
    const payload = await this.insights.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(payload).send(reply)
  }

  /** POST /ai/price-suggestion */
  async createPriceSuggestion (request: any, reply: any) {
    const payload = await this.price.execute(buildRequestContext(request), request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(payload).send(reply)
  }
}
