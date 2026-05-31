import { describe, it, expect } from 'vitest'
import { NotFoundError } from './not-found-error'
import { Resource } from '../../types/resource'
import { BaseError } from './base-error'

describe('NotFoundError', () => {
  it('estende BaseError com statusCode 404', () => {
    const err = new NotFoundError(Resource.Person, '123')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.statusCode).toBe(404)
  })

  it('mensagem inclui resource e apiMessage inclui id', () => {
    const err = new NotFoundError(Resource.Person, 'abc-123')
    expect(err.message).toContain('Person')
    expect(err.apiMessage).toContain('abc-123')
    expect(err.apiMessage).toContain('Person')
  })

  it('code é APP-0001', () => {
    const err = new NotFoundError(Resource.Person, '1')
    expect(err.code).toBe('APP-0001')
  })

  it('mantém stack trace de Error', () => {
    const err = new NotFoundError(Resource.Person, '1')
    expect(err.stack).toBeDefined()
  })
})
