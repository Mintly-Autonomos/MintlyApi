import { PRICE_REVIEW_ALERT_DAYS } from 'mintly-lib'

const DAY_MS = 86_400_000

/** Dias inteiros desde `date` até `now` (nunca negativo). */
export function daysSince (date: Date | string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS))
}

/** O preço pede revisão quando a última revisão tem PRICE_REVIEW_ALERT_DAYS dias ou mais. */
export function isPriceStale (reviewedAt: Date | string, now: Date, thresholdDays: number = PRICE_REVIEW_ALERT_DAYS): boolean {
  return daysSince(reviewedAt, now) >= thresholdDays
}

/** Data-limite: pratos revisados nesta data ou antes entram nos avisos. */
export function staleCutoff (now: Date, thresholdDays: number = PRICE_REVIEW_ALERT_DAYS): Date {
  return new Date(now.getTime() - thresholdDays * DAY_MS)
}
