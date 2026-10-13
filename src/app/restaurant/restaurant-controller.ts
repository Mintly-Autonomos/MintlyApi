import { StatusCodes } from 'http-status-codes'
import { buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder } from '../../core/builders/response-builder/response-builder'
import { GetRestaurantProfileQuery } from './use-cases/get-restaurant-profile.query'
import { UpdateRestaurantUseCase } from './use-cases/update-restaurant.use-case'

export class RestaurantController {
  constructor (
    private readonly profileQuery: GetRestaurantProfileQuery = new GetRestaurantProfileQuery(),
    private readonly updateUseCase: UpdateRestaurantUseCase = new UpdateRestaurantUseCase(),
  ) {}

  async me (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const result = await this.profileQuery.execute(ctx, (request.query ?? {}).month)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }

  async updateMe (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const result = await this.updateUseCase.execute(ctx, request.body)
    return new ResponseBuilder().status(StatusCodes.OK).payload(result).send(reply)
  }
}
