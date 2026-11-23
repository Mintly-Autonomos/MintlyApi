import { RestaurantTaxProfile, TaxRegime } from 'mintly-lib'
import { RequestContext } from '../../core/context/request-context'
import { TaxContextLoader } from './tax-context'
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

  async execute (ctx: RequestContext, p: {
    regime: TaxRegime | null
    referenceMonth: string
    restaurant?: { activityStart?: string | null, revenueBeforeMintly?: { month: string, amount: number }[] | null } | null
  }): Promise<RestaurantTaxProfile> {
    const tax = await new TaxContextLoader(this.taxRepo, this.settingsRepo).load(ctx, { regime: p.regime, restaurant: p.restaurant ?? null, months: [p.referenceMonth] })
    return buildTaxProfile({
      regime: p.regime,
      referenceMonth: p.referenceMonth,
      firstMonth: tax.history.firstMonth,
      revenueByMonth: tax.history.revenueByMonth,
      unknownMonths: tax.history.unknownMonths,
      meiMonthlyDas: tax.das.get(p.referenceMonth)?.value ?? null,
    })
  }
}
