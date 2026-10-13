import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { ExpensesQuery } from './use-cases/expenses.query'

export class ExpensesController {
  constructor (private readonly query: ExpensesQuery = new ExpensesQuery()) {}

  /** GET /reports/expenses?month=AAAA-MM&channel=dineIn|delivery */
  async get (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { month, channel } = request.query ?? {}
    const report = await this.query.execute(ctx, month, channel)
    return new ResponseBuilder().status(StatusCodes.OK).payload(report).send(reply)
  }
}
