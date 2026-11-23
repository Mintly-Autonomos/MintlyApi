import { restaurantUpdateSchema } from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { RestaurantRepository } from '../restaurant-repository'
import { toLocalMonth } from '../../reports/shared/period'

/**
 * PATCH /restaurants/me — nome, regime tributário, equipe com a carga semanal (P.4: troca a lista inteira) e, para o
 * Simples, o mês de abertura e o faturamento antes do Mintly (reteste 22/11, T2). O schema é estrito: audit,
 * restaurantId e qualquer outro campo são rejeitados (400 pelo error handler).
 * Só o dono chama (a trava fica no controller, que lê o papel do banco).
 */
export class UpdateRestaurantUseCase {
  constructor (private readonly repo: RestaurantRepository = new RestaurantRepository()) {}

  async execute (ctx: RequestContext, body: unknown): Promise<any> {
    const changes = restaurantUpdateSchema.parse(body ?? {}) as Record<string, unknown>
    // O `.partial()` do Sapphire aceita null: recusamos aqui. Nome vazio deixaria o
    // restaurante sem nome; "desconfigurar" o regime não está na spec.
    if ('name' in changes && (typeof changes.name !== 'string' || changes.name.trim() === '')) {
      throw new ValidationError('name não pode ser vazio.')
    }
    if ('taxRegime' in changes && changes.taxRegime == null) {
      throw new ValidationError('taxRegime inválido: use mei, simplesNacionalAnexoI ou simplesNacionalAnexoII.')
    }
    if ('team' in changes) {
      if (!Array.isArray(changes.team)) throw new ValidationError('team inválido: envie a lista da equipe ([] para limpar).')
      // Nome sem espaços nas pontas (só espaços não vale) e horas com uma casa decimal.
      const team = (changes.team as Array<{ name: string, weeklyHours: number }>).map((p) => ({
        name: p.name.trim(),
        weeklyHours: Math.round(p.weeklyHours * 10) / 10,
      }))
      if (team.some((p) => p.name === '')) throw new ValidationError('Informe o nome de cada pessoa da equipe.')
      changes.team = team
    }
    // Reteste 22/11 (T2): início da atividade e faturamento antes do Mintly, para o RBT12 do Simples.
    const currentMonth = toLocalMonth(new Date())
    if ('activityStart' in changes) {
      const v = changes.activityStart
      if (typeof v !== 'string') throw new ValidationError('activityStart inválido: use AAAA-MM ("" para apagar).')
      if (v > currentMonth) throw new ValidationError('O mês de abertura não pode ser depois do mês atual.')
    }
    if ('revenueBeforeMintly' in changes) {
      if (!Array.isArray(changes.revenueBeforeMintly)) throw new ValidationError('revenueBeforeMintly inválido: envie a lista ([] para limpar).')
      const rows = changes.revenueBeforeMintly as Array<{ month: string, amount: number }>
      if (rows.some((r) => r.month > currentMonth)) throw new ValidationError('O faturamento anterior não pode ser de um mês futuro.')
      if (new Set(rows.map((r) => r.month)).size !== rows.length) throw new ValidationError('Cada mês do faturamento anterior aparece uma vez só.')
      changes.revenueBeforeMintly = rows
        .map((r) => ({ month: r.month, amount: Math.round(r.amount * 100) / 100 }))
        .sort((a, b) => a.month.localeCompare(b.month))
    }
    if (Object.keys(changes).length === 0) return this.repo.findMine(ctx)
    return this.repo.updateMine(ctx, {
      ...changes,
      'audit.updatedAt': new Date(),
      'audit.updatedBy': ctx.userId,
    })
  }
}
