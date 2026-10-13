import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { TaxRegime } from 'mintly-lib'
import { mongoConnection } from '../../infrastructure/db/mongodb'
import { APP_DB } from '../environment/env-allowlist'
import { toDecimal128 } from '../../core/money/money'
import { toLocalMonth, startOfLocalMonth, addMonths } from '../reports/shared/period'
import { TaxProfileQuery } from './tax-profile.query'
import { TAX_SETTINGS_COLLECTION } from './tax-settings-repository'
import { TAX_SCENARIO_EXPECTED, taxScenarioMovements } from './tax-scenario'

const ENV = 'int_tax_profile'
const refs = (restaurantId: string) => ({ restaurantId, account: { _id: 'acc', name: 'Caixa', type: 'cash' }, revenueCategory: { _id: 'cat', name: 'Vendas' } })

describe('TaxProfileQuery (Integration)', () => {
  let replset: MongoMemoryReplSet
  const query = new TaxProfileQuery()
  const month = toLocalMonth(new Date())

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()
  })

  afterAll(async () => {
    await mongoConnection.disconnect()
    await replset.stop()
  })

  const movements = () => mongoConnection.getDatabase(ENV).collection('financial_movements')
  const line = (restaurantId: string, over: Record<string, unknown>) => ({
    restaurantId,
    title: 'x',
    statusSource: 'auto',
    feeValue: toDecimal128(0),
    account: refs('x').account,
    paymentMethod: 'pix',
    origin: 'manual',
    history: [],
    audit: { createdAt: new Date(), updatedAt: new Date() },
    ...over,
  })

  it('Simples: confere o cenário (RBT12, faixa e troca de faixa)', async () => {
    await movements().insertMany(taxScenarioMovements(month, refs('r-simples')))

    const p = await query.execute({ env: ENV, restaurantId: 'r-simples' }, { regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: month })

    expect(p).toMatchObject({
      rbt12: TAX_SCENARIO_EXPECTED.rbt12,
      monthsOfHistory: TAX_SCENARIO_EXPECTED.monthsOfHistory,
      rbt12Proportional: false,
      bracket: { index: TAX_SCENARIO_EXPECTED.bracketIndex },
      previousBracketIndex: TAX_SCENARIO_EXPECTED.previousBracketIndex,
    })
    expect(p.effectiveRate).toBeCloseTo(TAX_SCENARIO_EXPECTED.effectiveRate, 10)
    expect(p.insights[0]).toMatchObject({ kind: 'bracketChanged', fromBracket: 2, toBracket: 3 })
  })

  it('ignora saídas, canceladas e outro restaurante', async () => {
    const date = new Date(startOfLocalMonth(month).getTime() + 12 * 3600_000)
    const revenue = { _id: 'c', name: 'V', type: 'revenue' }
    await movements().insertMany([
      line('r-filtros', { direction: 'in', status: 'settled', date, grossValue: toDecimal128(1000), netValue: toDecimal128(1000), category: revenue }),
      line('r-filtros', { direction: 'out', status: 'settled', date, grossValue: toDecimal128(9999), netValue: toDecimal128(9999), category: { _id: 'c', name: 'D', type: 'expense' } }),
      line('r-filtros', { direction: 'in', status: 'cancelled', date, grossValue: toDecimal128(9999), netValue: toDecimal128(9999), category: revenue }),
      line('r-outro', { direction: 'in', status: 'settled', date, grossValue: toDecimal128(9999), netValue: toDecimal128(9999), category: revenue }),
    ])

    const p = await query.execute({ env: ENV, restaurantId: 'r-filtros' }, { regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: month })

    expect(p).toMatchObject({ rbt12: 12_000, monthsOfHistory: 0, rbt12Proportional: true })
  })

  it('receita às 22h do último dia do mês anterior conta naquele mês', async () => {
    const lastMonthNight = new Date(startOfLocalMonth(month).getTime() - 2 * 3600_000) // 22h local do último dia de M-1
    await movements().insertOne(line('r-fuso', {
      direction: 'in',
      status: 'settled',
      date: lastMonthNight,
      grossValue: toDecimal128(2_000),
      netValue: toDecimal128(2_000),
      category: { _id: 'c', name: 'V', type: 'revenue' },
    }))

    const p = await query.execute({ env: ENV, restaurantId: 'r-fuso' }, { regime: TaxRegime.SimplesNacionalAnexoI, referenceMonth: month })

    // primeiro mês = M-1; 1 mês de histórico; RBT12 = 2.000 × 12
    expect(p).toMatchObject({ monthsOfHistory: 1, rbt12: 24_000, rbt12Proportional: true })
  })

  it('MEI: DAS vigente pelo validFrom; sem DAS semeado, null', async () => {
    const settings = mongoConnection.getDatabase(APP_DB).collection(TAX_SETTINGS_COLLECTION)

    const none = await query.execute({ env: ENV, restaurantId: 'r-mei' }, { regime: TaxRegime.Mei, referenceMonth: month })
    expect(none.meiMonthlyDas).toBeNull()

    await settings.insertMany([
      { validFrom: '2000-01', meiMonthlyDas: 50 },
      { validFrom: addMonths(month, -1), meiMonthlyDas: 80 },
      { validFrom: addMonths(month, 1), meiMonthlyDas: 99 },
    ])
    const p = await query.execute({ env: ENV, restaurantId: 'r-mei' }, { regime: TaxRegime.Mei, referenceMonth: month })
    expect(p.meiMonthlyDas).toBe(80)
  })
})
