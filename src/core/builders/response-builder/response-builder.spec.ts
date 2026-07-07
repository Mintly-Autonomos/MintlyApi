import { describe, it, expect, vi } from 'vitest'
import { ResponseBuilder } from './response-builder'
import { StatusCodes } from 'http-status-codes'
import type { FastifyReply } from 'fastify'

describe('ResponseBuilder', () => {
  describe('sem reply', () => {
    it('embrulha payload em { payload }', () => {
      const result = new ResponseBuilder()
        .payload({ id: '1', name: 'Ada' })
        .build()
      expect(result).toEqual({ payload: { id: '1', name: 'Ada' } })
    })

    it('inclui pagination quando fornecida', () => {
      const result = new ResponseBuilder()
        .payload([{ id: '1' }])
        .pagination({ page: 1, size: 10, totalItems: 1, totalPages: 1 })
        .build()
      expect(result).toEqual({
        payload: [{ id: '1' }],
        pagination: { page: 1, size: 10, totalItems: 1, totalPages: 1 },
      })
    })

    it('sem payload retorna { payload: null }', () => {
      const result = new ResponseBuilder().build()
      expect(result).toEqual({ payload: null })
    })

    it('aceita payload string', () => {
      const result = new ResponseBuilder().payload('texto').build()
      expect(result).toEqual({ payload: 'texto' })
    })
  })

  describe('send(reply)', () => {
    function mockReply (): FastifyReply {
      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      }
      return reply as unknown as FastifyReply
    }

    it('chama reply.status(200).send(envelope) por padrão', () => {
      const reply = mockReply()
      new ResponseBuilder()
        .payload({ id: '1' })
        .send(reply)

      expect(reply.status).toHaveBeenCalledWith(StatusCodes.OK)
      expect(reply.send).toHaveBeenCalledWith({ payload: { id: '1' } })
    })

    it('respeita status customizado', () => {
      const reply = mockReply()
      new ResponseBuilder()
        .status(StatusCodes.CREATED)
        .payload({ id: '1' })
        .send(reply)

      expect(reply.status).toHaveBeenCalledWith(StatusCodes.CREATED)
    })

    it('inclui pagination via reply', () => {
      const reply = mockReply()
      new ResponseBuilder()
        .payload([{ id: '1' }])
        .pagination({ page: 1, size: 10, totalItems: 1, totalPages: 1 })
        .send(reply)

      expect(reply.send).toHaveBeenCalledWith({
        payload: [{ id: '1' }],
        pagination: { page: 1, size: 10, totalItems: 1, totalPages: 1 },
      })
    })
  })

  describe('chainable', () => {
    it('todos os setters retornam this', () => {
      const builder = new ResponseBuilder()
      expect(builder.payload({})).toBe(builder)
      expect(builder.pagination({ page: 1, size: 10, totalItems: 0, totalPages: 0 })).toBe(builder)
      expect(builder.status(StatusCodes.OK)).toBe(builder)
    })
  })
})
