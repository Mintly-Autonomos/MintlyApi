import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { ResultQuery } from './use-cases/result.query'

export class ResultController {
  constructor (private readonly query: ResultQuery = new ResultQuery()) {}

  /** GET /reports/result?month=AAAA-MM */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const report = await this.query.execute(ctx, (request.query ?? {}).month)
    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
