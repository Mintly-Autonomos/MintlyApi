import { REPORT_TIME_ZONE } from './period'

/**
 * Ajuste A1: acumulador do `$group` que soma `field` só dos lançamentos com dia do
 * mês (em SP) até `untilDay` — a base "mesmo período" da comparação do mês atual.
 */
export function sumUntilDay (field: string, untilDay: number): Record<string, unknown> {
  return {
    $sum: {
      $cond: [
        { $lte: [{ $dayOfMonth: { date: '$date', timezone: REPORT_TIME_ZONE } }, untilDay] },
        { $ifNull: [field, 0] },
        0,
      ],
    },
  }
}
