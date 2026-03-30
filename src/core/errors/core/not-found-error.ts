import { Resource } from '../../types/resource'
import { BaseError } from './base-error'
import { errorGlossary } from './error-glossary'

export class NotFoundError extends BaseError {
  constructor (resource: Resource, id: any) {
    super(
      errorGlossary.notFound.message + ` Recurso: ${resource}`,
      errorGlossary.notFound.apiMessage + ` Resource: ${resource}, ID: ${id}.`,
      errorGlossary.notFound.code,
      404,
    )
  }
}
