import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { FinancialMovementRepository, MovementListFilter } from './financial-movement-repository'
import { RegisterMovementUseCase, RegisterMovementInput } from './use-cases/register-movement.use-case'

export class FinancialMovementController {
  constructor (
    private readonly movementRepo: FinancialMovementRepository,
    private readonly registerUseCase: RegisterMovementUseCase,
  ) {}

  /** POST /financial-movements — registra entrada/saída (transacional). */
  async register (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const result = await this.registerUseCase.execute(request.body as RegisterMovementInput, ctx)

    return new ResponseBuilder()
      .response(reply)
      .status(StatusCodes.CREATED)
      .payload(result)
      .build()
  }

  /** GET /financial-movements — listagem (recente→antiga, busca/filtro). */
  async list (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const filter = (request.query ?? {}) as MovementListFilter
    const result = await this.movementRepo.findAll(filter, ctx)
    const size = Number(filter.size) || 10

    return new ResponseBuilder()
      .response(reply)
      .status(StatusCodes.OK)
      .payload(result)
      .pagination({
        ...filter,
        totalItems: result.length,
        totalPages: Math.ceil(result.length / size),
      } as any)
      .build()
  }
}
