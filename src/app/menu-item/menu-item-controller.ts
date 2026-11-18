import { StatusCodes } from 'http-status-codes'
import { CrudController } from '../../core/crud/crud-controller'
import { ContextSource, buildRequestContext } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import {
  menuItemInsertSchema,
  menuItemUpdateSchema,
  menuItemPriceSchema,
  menuCategoryProfilesUpdateSchema,
  MenuCategoryProfile,
  MenuItem,
  MenuItemPriceAlert,
  RecordStatus,
} from 'mintly-lib'
import { MenuItemRepository } from './menu-item-repository'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { Resource } from '../../core/types/resource'
import { escapeRegex } from '../../core/util/escape-regex'
import { daysSince, staleCutoff } from './menu-item-rules'
import { RestaurantRepository } from '../restaurant/restaurant-repository'

export class MenuItemController extends CrudController<MenuItem, string> {
  constructor (private readonly repo: MenuItemRepository) {
    super(repo, menuItemInsertSchema as any, menuItemUpdateSchema as any, Resource.MenuItem)
  }

  async findAll (filter: any, source?: ContextSource): Promise<ResponseStructure> {
    if (filter.name) {
      filter.name = { $regex: escapeRegex(String(filter.name)), $options: 'i' }
    }
    return super.findAll(filter, source)
  }

  /**
   * PATCH /:id. `priceSensitivity: null` tira a sensibilidade do prato (volta a valer o perfil da categoria):
   * o update genérico gravaria `null`, então o campo é removido à parte.
   */
  async update (id: string, item: any, source?: ContextSource): Promise<ResponseStructure> {
    if (!item || item.priceSensitivity !== null) return super.update(id, item, source)
    const { priceSensitivity: _limpar, ...rest } = item
    if (Object.keys(rest).length > 0) await super.update(id, rest, source)
    else await this.loadOwn(id, source)
    const updated = await this.repo.applyUnset(id, ['priceSensitivity'], buildRequestContext(source))
    return new ResponseBuilder().payload(updated as any).build()
  }

  /** GET /category-profiles — perfil de venda escolhido para cada categoria do cardápio. */
  async categoryProfiles (request: any, reply: any) {
    const restaurant = await new RestaurantRepository().findMine(buildRequestContext(request))
    const profiles: MenuCategoryProfile[] = restaurant.menuCategoryProfiles ?? []
    return new ResponseBuilder().status(StatusCodes.OK).payload({ profiles } as any).send(reply)
  }

  /**
   * PUT /category-profiles — troca a lista inteira. Categoria sem espaços nas pontas; a mesma categoria escrita
   * com caixa diferente conta uma vez só (vale a última). Escrita em /menu-items: Operação não pode (access-control).
   */
  async saveCategoryProfiles (request: any, reply: any) {
    const { profiles } = menuCategoryProfilesUpdateSchema.parse(request.body ?? {}) as { profiles: MenuCategoryProfile[] }
    const porNome = new Map<string, MenuCategoryProfile>()
    for (const p of profiles) {
      const category = p.category.trim()
      if (category) porNome.set(category.toLocaleLowerCase('pt-BR'), { category, profile: p.profile })
    }
    const lista = [...porNome.values()]
    const ctx = buildRequestContext(request)
    await new RestaurantRepository().updateMine(ctx, {
      menuCategoryProfiles: lista,
      'audit.updatedAt': new Date(),
      'audit.updatedBy': ctx.userId,
    })
    return new ResponseBuilder().status(StatusCodes.OK).payload({ profiles: lista } as any).send(reply)
  }

  /** Prato do restaurante do contexto, ou 404. */
  private async loadOwn (id: string, request: any): Promise<MenuItem> {
    const ctx = buildRequestContext(request)
    const current = await this.repo.find({ _id: id as any, restaurantId: ctx.restaurantId } as any, ctx)
    if (!current) throw new NotFoundError(Resource.MenuItem, id)
    return current as MenuItem
  }

  /**
   * Muda o preço. Conta como revisão (silencia o aviso). Se o valor é o mesmo que já estava,
   * só a revisão é registrada — `priceUpdatedAt` continua sendo a última mudança real.
   */
  async updatePrice (request: any, reply: any) {
    const { id } = request.params
    const { price } = menuItemPriceSchema.parse(request.body ?? {}) as { price: number }
    const current = await this.loadOwn(id, request)
    const now = new Date()

    const set: Record<string, unknown> = { priceReviewedAt: now }
    if (price !== current.price) {
      set.price = price
      set.priceUpdatedAt = now
    }

    const updated = await this.repo.applySet(id, set, buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(updated as any).send(reply)
  }

  /** "Não quero mudar": mantém o valor e registra a revisão (silencia o aviso). */
  async keepPrice (request: any, reply: any) {
    const { id } = request.params
    await this.loadOwn(id, request)
    const updated = await this.repo.applySet(id, { priceReviewedAt: new Date() }, buildRequestContext(request))
    return new ResponseBuilder().status(StatusCodes.OK).payload(updated as any).send(reply)
  }

  /** Pratos ativos com o preço sem revisão há PRICE_REVIEW_ALERT_DAYS dias ou mais. */
  async priceAlerts (request: any, reply: any) {
    const ctx = buildRequestContext(request)
    const now = new Date()
    const stale = await this.repo.findStale(staleCutoff(now), ctx)
    const alerts: MenuItemPriceAlert[] = stale.map((item) => ({
      ...item,
      daysSinceReview: daysSince(item.priceReviewedAt, now),
    }))
    return new ResponseBuilder().status(StatusCodes.OK).payload(alerts as any).send(reply)
  }

  async inactivate (request: any, reply: any) {
    return await this.setStatus(request, reply, RecordStatus.Inactive, 'Prato inativado com sucesso.')
  }

  async reactivate (request: any, reply: any) {
    return await this.setStatus(request, reply, RecordStatus.Active, 'Prato reativado com sucesso.')
  }

  private async setStatus (request: any, reply: any, status: RecordStatus, message: string) {
    const { id } = request.params
    const current = await this.loadOwn(id, request)
    if (current.status !== status) {
      await this.repo.applySet(id, { status }, buildRequestContext(request))
    }
    return new ResponseBuilder().status(StatusCodes.OK).payload({ message }).send(reply)
  }
}
