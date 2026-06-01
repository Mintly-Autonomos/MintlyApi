import { describe, it, expect } from 'vitest'
import { UnsupportedQueryKindError } from './unsupported-query-kind-error'
import { BaseError } from './base-error'

describe('UnsupportedQueryKindError', () => {
  it('estende BaseError com statusCode 501', () => {
    const err = new UnsupportedQueryKindError('sql:select', 'mongodb')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(UnsupportedQueryKindError)
    expect(err.statusCode).toBe(501)
  })

  it('mensagem inclui kind e backend', () => {
    const err = new UnsupportedQueryKindError('sql:select', 'mongodb')
    expect(err.message).toContain('sql:select')
    expect(err.message).toContain('mongodb')
  })

  it('apiMessage inclui kind e backend', () => {
    const err = new UnsupportedQueryKindError('mongo:pipeline', 'postgres')
    expect(err.apiMessage).toContain('mongo:pipeline')
    expect(err.apiMessage).toContain('postgres')
  })

  it('code é APP-0002', () => {
    const err = new UnsupportedQueryKindError('sql:select', 'mongodb')
    expect(err.code).toBe('APP-0002')
  })
})
