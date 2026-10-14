import { CashFlowReport, ExpensesReport, ResultReport } from 'mintly-lib'
import { OverviewInput } from './overview-metrics'

/**
 * Entradas da Visão Geral montadas à mão (relatórios já calculados), M = 2026-07,
 * hoje = 10/08/2026 (mês fechado). Esperados no plano
 * (specs/modulos-novos/20261013/plan-visao-geral.md, "Cenário").
 */
export const OVERVIEW_MONTH = '2026-07'
export const OVERVIEW_TODAY = new Date('2026-08-10T15:00:00Z')

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
const REVENUE = [45_000, 47_000, 50_000, 52_000, 54_200, 58_400]
const PROFIT = [3_000, 3_500, 4_200, 4_900, 5_100, 6_372]
const EXPENSE = [40_000, 42_000, 44_000, 46_000, 49_100, 52_000]

export function overviewScenario (): OverviewInput {
  const result = {
    referenceMonth: OVERVIEW_MONTH,
    previousMonth: '2026-06',
    current: { grossRevenue: 58_400, taxes: 3_504, netRevenue: 54_896, cmv: 21_024, grossMargin: 33_872, operatingExpenses: 27_500, netProfit: 6_372, netMargin: 6_372 / 58_400 },
    previous: { grossRevenue: 54_200, taxes: 3_252, netRevenue: 50_948, cmv: 18_000, grossMargin: 32_948, operatingExpenses: 27_848, netProfit: 5_100, netMargin: 5_100 / 54_200 },
    deltas: { grossRevenue: 0.077, taxes: null, netRevenue: null, cmv: null, grossMargin: null, operatingExpenses: null, netProfit: 0.249 },
    tax: { regime: 'simplesNacionalAnexoI', effectiveRate: 0.06, meiMonthlyDas: null },
    operatingExpenseItems: [],
    breakEven: { fixedCosts: 15_200, variableCosts: 30_000, contributionMarginPct: 0.45, breakEvenRevenue: 30_470.96, reachedOnDay: 19 },
    history: MONTHS.map((month, i) => ({ month, grossRevenue: REVENUE[i], netProfit: PROFIT[i], netMargin: PROFIT[i] / REVENUE[i] })),
    insights: [],
  } as unknown as ResultReport

  const cashFlow = {
    horizon: 30,
    today: '2026-08-10',
    cashToday: 18_500,
    receivable: 32_500,
    payable: 47_100,
    projectedBalance: 3_900,
    lowestBalance: { date: '2026-08-22', balance: 900 },
    overdue: { count: 0, receivable: 0, payable: 0 },
    safetyThreshold: { value: 6_475, days: 7, avgDailyOutflow: 925 },
    projection: [],
    realized: [{ date: '2026-08-09', balance: 18_100, inflows: 0, outflows: 0 }, { date: '2026-08-10', balance: 18_500, inflows: 400, outflows: 0 }],
    weeks: [],
    dueItems: [],
    insights: [{ kind: 'criticalDay', severity: 'warning', date: '2026-08-22', balance: 900, threshold: 6_475 }],
  } as unknown as CashFlowReport

  const item = (key: string, dreGroup: string, amount: number, previous: number) => ({ key, kind: 'category', categoryId: key, name: key, behavior: 'variable', dreGroup, amount, previous, average3: null, deltaPrevious: null, deltaAverage3: null, pctOfRevenue: null, subitems: [], hasAnomaly: false, history: [{ month: '2026-06', amount: previous }, { month: '2026-07', amount }], projected: null })
  const expenses = {
    referenceMonth: OVERVIEW_MONTH,
    previousMonth: '2026-06',
    channel: null,
    revenue: { current: 58_400, previous: 54_200 },
    total: { current: 52_000, previous: 49_100, average3: null, deltaPrevious: null, deltaAverage3: null },
    cmv: { amount: 21_024, pctOfRevenue: 21_024 / 58_400, target: { min: 0.28, max: 0.35 } },
    primeCost: { amount: 29_024, cmv: 21_024, labor: 8_000, pctOfRevenue: 29_024 / 58_400, targetMax: 0.65 },
    platformFee: { amount: 0, previous: 0, deltaPrevious: null, deliveryRevenue: 0, pctOfDelivery: null },
    byBehavior: { fixed: 0, variable: 0, mixed: 0 },
    items: [item('cmv', 'cmv', 21_024, 18_000), item('pro', 'labor', 8_000, 8_000), item('alu', 'opex', 6_000, 6_000)],
    sharedExcluded: null,
    history: MONTHS.map((month, i) => ({ month, total: EXPENSE[i] })),
    anomalies: [{ itemKey: 'cmv', categoryId: 'cmv', categoryName: 'CMV / Insumos', subcategoryId: 's', subitemKey: 's', name: 'Embalagens', amount: 2_400, average3: 1_500, excess: 900, pctAbove: 0.6 }],
    projection: null,
    anomalyRule: { minPctAbove: 0.5, minExcess: 100, minHistoryMonths: 2 },
  } as unknown as ExpensesReport

  return { result, cashFlow, expenses, today: OVERVIEW_TODAY }
}
