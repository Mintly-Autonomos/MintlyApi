import { FastifyReply } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { PaginationResponseDto } from 'mintly-lib'

type ResponsePayload = string | object | any[] | null

export interface ResponseStructure {
  payload: ResponsePayload
  pagination?: PaginationResponseDto
}

/**
 * Monta o envelope de resposta (`payload` + `pagination`). Dois terminais
 * explícitos, sem união de tipo nem cast:
 *  - `build()` devolve a ESTRUTURA pura (o handler retorna e o Fastify serializa);
 *  - `send(reply)` ENVIA a estrutura com o status (retorna o FastifyReply).
 */
export class ResponseBuilder {
  private statusCode: number = StatusCodes.OK
  private data?: ResponsePayload
  private paginationData?: PaginationResponseDto

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

  /** Estrutura pura da resposta (payload + pagination opcional). */
  build (): ResponseStructure {
    const response: ResponseStructure = {
      payload: this.data ?? null,
    }

    if (this.paginationData) {
      response.pagination = this.paginationData
    }

    return response
  }

  /** Envia a estrutura via reply, aplicando o status. */
  send (reply: FastifyReply): FastifyReply {
    return reply.status(this.statusCode).send(this.build())
  }
}
