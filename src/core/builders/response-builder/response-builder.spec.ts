import { describe, it, expect, vi } from 'vitest'
import { StatusCodes } from 'http-status-codes'
import { ResponseBuilder } from './response-builder'

function fakeReply () {
  return { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as any
}

describe('ResponseBuilder', () => {
  it('build() sem reply lança', () => {
    expect(() => new ResponseBuilder().payload({ a: 1 }).build()).toThrow(/reply/i)
  })

  it('envia payload com status 200 por padrão', () => {
    const reply = fakeReply()
    new ResponseBuilder().response(reply).payload({ a: 1 }).build()
    expect(reply.status).toHaveBeenCalledWith(StatusCodes.OK)
    expect(reply.send).toHaveBeenCalledWith({ payload: { a: 1 } })
  })

  it('payload null quando não informado, com status custom', () => {
    const reply = fakeReply()
    new ResponseBuilder().response(reply).status(StatusCodes.NO_CONTENT).build()
    expect(reply.status).toHaveBeenCalledWith(StatusCodes.NO_CONTENT)
    expect(reply.send).toHaveBeenCalledWith({ payload: null })
  })

  it('inclui pagination quando setada', () => {
    const reply = fakeReply()
    const pagination = { page: 1, size: 10, totalItems: 1, totalPages: 1 }
    new ResponseBuilder().response(reply).payload([]).pagination(pagination as any).build()
    expect(reply.send).toHaveBeenCalledWith({ payload: [], pagination })
  })
})
