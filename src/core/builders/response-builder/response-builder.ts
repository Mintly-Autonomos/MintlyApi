import { FastifyReply } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { PaginationResponseDto } from 'mintly-lib'

type ResponsePayload = string | object | any[] | null

export interface ResponseStructure {
  payload: ResponsePayload
  pagination?: PaginationResponseDto
}

export class ResponseBuilder {
  private reply?: FastifyReply
  private statusCode: number = StatusCodes.OK
  private data?: ResponsePayload
  private paginationData?: PaginationResponseDto

  response (reply: FastifyReply): ResponseBuilder {
    this.reply = reply
    return this
  }

  status (code: StatusCodes): ResponseBuilder {
    this.statusCode = code
    return this
  }

  payload (data: ResponsePayload): ResponseBuilder {
    this.data = data
    return this
  }

  pagination (pagination: PaginationResponseDto): ResponseBuilder {
    this.paginationData = pagination
    return this
  }

  build (): FastifyReply | ResponseStructure {
    const response: ResponseStructure = {
      payload: this.data ?? null,
    }

    if (this.paginationData) {
      response.pagination = this.paginationData
    }

    if (this.reply) {
      return this.reply.status(this.statusCode).send(response)
    }

    return response
  }
}
