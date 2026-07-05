import { FinancialCategoryRepository } from '../financial-category-repository'
import { RequestContext } from '../../../core/context/request-context'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { Resource } from '../../../core/types/resource'
import { RecordStatus } from 'mintly-lib'

export class InactivateCategoryUseCase {
  constructor (private readonly repo: FinancialCategoryRepository = new FinancialCategoryRepository()) {}

  /** Inativa a categoria (MIN-71). Livre — sem guard de saldo, ao contrário da conta. */
  async inactivate (id: string, ctx: RequestContext): Promise<void> {
    await this.setStatus(id, ctx, RecordStatus.Inactive, 'inactivate')
  }

  /** Reativa a categoria. Simétrica ao inactivate — o narrative permite reativação livre. */
  async reactivate (id: string, ctx: RequestContext): Promise<void> {
    await this.setStatus(id, ctx, RecordStatus.Active, 'reactivate')
  }

  private async setStatus (id: string, ctx: RequestContext, status: RecordStatus, action: string): Promise<void> {
    const target = await this.repo.find({ _id: id as any, restaurantId: ctx.restaurantId } as any, ctx)

    if (!target) {
      throw new NotFoundError(Resource.FinancialCategory, id)
    }

    // Idempotência: já está no status pedido, não há nada a fazer.
    if ((target as any).status === status) {
      return
    }

    const history = Array.isArray((target as any).history) ? [...(target as any).history] : []
    history.push({ at: new Date(), by: ctx.userId ?? 'system', action })

    await this.repo.update(id, { status, history } as any, ctx)
  }
}
