import { TaxRegime } from 'mintly-lib'
import { RequestContext } from '../../core/context/request-context'
import { addMonths } from '../reports/shared/period'
import { monthTax, MonthTax } from '../reports/result/result-metrics'
import { TaxHistory, buildTaxHistory, typicalDas } from './tax-history'
import { TaxRepository } from './tax-repository'
import { TaxSettingsRepository } from './tax-settings-repository'

export interface MeiDas {
  value: number | null
  estimated: boolean
}

/**
 * O que o imposto de vários meses precisa, lido uma vez (reteste 22/11): o histórico de receita com o início da
 * atividade e o faturamento anterior ao Mintly (T2), e o DAS fixo do MEI de cada mês (T1). O Resultado, a série
 * (`/reports/timeseries`) e o perfil tributário usam este mesmo carregador: o imposto é o mesmo nas telas.
 */
export class TaxContextLoader {
  constructor (
    private readonly taxRepo: TaxRepository = new TaxRepository(),
    private readonly settings: TaxSettingsRepository = new TaxSettingsRepository(),
  ) {}

  async load (ctx: RequestContext, p: {
    regime: TaxRegime | null
    restaurant: { activityStart?: string | null, revenueBeforeMintly?: { month: string, amount: number }[] | null } | null
    /** Meses que vão ter imposto calculado (`AAAA-MM`, em ordem). */
    months: string[]
  }): Promise<{ history: TaxHistory, das: Map<string, MeiDas>, taxOf: (month: string) => MonthTax }> {
    const first = p.months[0]
    const last = p.months[p.months.length - 1]
    const mei = p.regime === TaxRegime.Mei
    const [firstRevenueMonth, revenueByMonth, configured, payments] = await Promise.all([
      this.taxRepo.firstRevenueMonth(ctx),
      this.taxRepo.revenueByMonth(ctx, { from: addMonths(first, -13), to: last }),
      mei
        ? Promise.all(p.months.map(async (m) => [m, await this.settings.meiMonthlyDasAt(m)] as const))
        : Promise.resolve([] as (readonly [string, number | null])[]),
      mei ? this.taxRepo.taxPayments(ctx, { from: addMonths(last, -11), to: last }) : Promise.resolve([] as number[]),
    ])
    const history = buildTaxHistory({
      firstRevenueMonth,
      revenueByMonth,
      activityStart: p.restaurant?.activityStart ?? null,
      revenueBeforeMintly: p.restaurant?.revenueBeforeMintly ?? null,
    })
    // O DAS típico vale para todos os meses sem valor configurado: é um valor fixo, não muda com o que foi pago no mês.
    const typical = typicalDas(payments)
    const das = new Map<string, MeiDas>()
    for (const [m, v] of configured) {
      das.set(m, v != null && v > 0 ? { value: v, estimated: false } : { value: typical, estimated: typical != null })
    }
    const taxOf = (month: string) => monthTax({
      regime: p.regime,
      month,
      firstMonth: history.firstMonth,
      revenueByMonth: history.revenueByMonth,
      unknownMonths: history.unknownMonths,
      meiMonthlyDas: das.get(month)?.value ?? null,
      meiDasEstimated: das.get(month)?.estimated ?? false,
    })
    return { history, das, taxOf }
  }
}
