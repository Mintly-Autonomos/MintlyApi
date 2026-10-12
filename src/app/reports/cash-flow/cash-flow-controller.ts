import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { CashFlowQuery } from './use-cases/cash-flow.query'

export class CashFlowController {
  constructor (private readonly query: CashFlowQuery = new CashFlowQuery()) {}

  /** GET /reports/cash-flow?horizon= — o schema da rota já validou e aplicou o padrão. */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { horizon } = (request.query ?? {}) as { horizon?: number }
    const report = await this.query.execute(ctx, horizon)

    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
