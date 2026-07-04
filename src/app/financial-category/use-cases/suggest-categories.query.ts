import { FinancialCategoryRepository } from '../financial-category-repository'
import { RequestContext } from '../../../core/context/request-context'
import { CategoryType, FinancialCategory, MovementDirection } from 'mintly-lib'

const DIRECTION_TO_TYPE: Record<MovementDirection, CategoryType> = {
  [MovementDirection.In]: CategoryType.Revenue,
  [MovementDirection.Out]: CategoryType.Expense,
}

/**
 * SuggestCategoriesQuery (MIN-71): heurística de sugestão por recência+frequência
 * (usage/lastUsedAt denormalizados no schema — MIN-70). Read-only.
 *
 * NOTA (achado durante o planejamento): register-movement.use-case.ts (MIN-49/50)
 * ainda NÃO incrementa usage/lastUsedAt ao registrar uma movimentação — por isso
 * essa query, hoje, sempre verá usage=0/lastUsedAt=null em categorias recém-criadas
 * até essa manutenção ser implementada (fora do escopo desta tarefa, conforme a
 * spec técnica: "Fora de escopo: Manutenção de usage/lastUsedAt (MIN-49/50)").
 */
export class SuggestCategoriesQuery {
  constructor (private readonly repo: FinancialCategoryRepository = new FinancialCategoryRepository()) {}

  async execute (ctx: RequestContext, direction: MovementDirection): Promise<FinancialCategory[]> {
    const type = DIRECTION_TO_TYPE[direction]
    return this.repo.findSuggestions(ctx, type)
  }
}
