import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { FinancialMovementRepository, MovementListFilter } from './financial-movement-repository'
import { RegisterMovementUseCase, RegisterMovementInput } from './use-cases/register-movement.use-case'
import { ChangeMovementStatusUseCase } from './use-cases/change-movement-status.use-case'
import { UpdateMovementUseCase, UpdateMovementInput } from './use-cases/update-movement.use-case'
import { RecomputeBalancesUseCase } from './use-cases/recompute-balances.use-case'

export class FinancialMovementController {
  constructor (
    private readonly movementRepo: FinancialMovementRepository,
    private readonly registerUseCase: RegisterMovementUseCase,
    private readonly changeStatusUseCase: ChangeMovementStatusUseCase,
    private readonly updateUseCase: UpdateMovementUseCase,
    private readonly recomputeUseCase: RecomputeBalancesUseCase,
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

  /** PATCH /financial-movements/:id/status — muda status (corrige saldo). */
  async changeStatus (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { id } = request.params
    const { status } = (request.body ?? {}) as { status: string }
    const result = await this.changeStatusUseCase.execute(id, status, ctx)

    return new ResponseBuilder().response(reply).status(StatusCodes.OK).payload(result).build()
  }

  /** PATCH /financial-movements/:id — edita (reverte+aplica saldo). */
  async update (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { id } = request.params
    const result = await this.updateUseCase.execute(id, request.body as UpdateMovementInput, ctx)

    return new ResponseBuilder().response(reply).status(StatusCodes.OK).payload(result).build()
  }

  /** POST /financial-movements/recompute-balances — reconcilia o saldo da conta. */
  async recompute (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const { accountId } = (request.body ?? {}) as { accountId: string }
    const result = await this.recomputeUseCase.execute(accountId, ctx)

    return new ResponseBuilder().response(reply).status(StatusCodes.OK).payload(result).build()
  }
}
