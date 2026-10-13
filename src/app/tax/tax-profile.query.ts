import { RestaurantTaxProfile, TaxRegime } from 'mintly-lib'
import { RequestContext } from '../../core/context/request-context'
import { addMonths } from '../reports/shared/period'
import { buildTaxProfile } from './tax-rules'
import { TaxRepository } from './tax-repository'
import { TaxSettingsRepository } from './tax-settings-repository'

/**
 * Perfil tributário de um mês. Uma consulta de receita (M-13 até M) serve o
 * RBT12 de M, o de M-1 (faixa anterior) e o acumulado do ano (teto do MEI). A
 * fatia 4 (DRE) reaproveita esta query.
 */
export class TaxProfileQuery {
  constructor (
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly settingsRepo: TaxSettingsRepository = new TaxSettingsRepository(),
  ) {}

  async execute (ctx: RequestContext, p: { regime: TaxRegime | null; referenceMonth: string }): Promise<RestaurantTaxProfile> {
    const [firstMonth, revenueByMonth, meiMonthlyDas] = await Promise.all([
      this.taxRepo.firstMovementMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(p.referenceMonth, -13), to: p.referenceMonth }),
      p.regime === TaxRegime.Mei ? this.settingsRepo.meiMonthlyDasAt(p.referenceMonth) : Promise.resolve(null),
    ])
    return buildTaxProfile({ regime: p.regime, referenceMonth: p.referenceMonth, firstMonth, revenueByMonth, meiMonthlyDas })
  }
}
