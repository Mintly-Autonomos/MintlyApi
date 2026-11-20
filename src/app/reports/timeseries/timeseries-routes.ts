import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../../core/context/build-request-context'
import { ResponseBuilder } from '../../../core/builders/response-builder/response-builder'
import { TimeseriesQuery } from './timeseries.query'

export async function timeseriesRoutes (fastify: FastifyInstance) {
  const query = new TimeseriesQuery()

  // GET /reports/timeseries?granularity=day|week|month&points=N&compare=previousYear — série do seletor Dia/Semana/Mês/Ano (P.3).
  fastify.get('/timeseries', async (request: any, reply) => {
    const report = await query.execute(buildRequestContext(request), request.query ?? {})
    return new ResponseBuilder().status(StatusCodes.OK).payload(report as any).send(reply)
  })
}
