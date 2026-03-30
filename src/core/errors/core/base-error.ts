export abstract class BaseError extends Error {
  apiMessage: string
  code: string
  statusCode: number

  constructor (
    message: string,
    apiMessage: string,
    code: string,
    statusCode: number,
  ) {
    super(message)
    this.name = this.constructor.name
    this.apiMessage = apiMessage
    this.code = code
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}
