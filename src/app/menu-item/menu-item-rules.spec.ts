import { describe, expect, it } from 'vitest'
import { PRICE_REVIEW_ALERT_DAYS } from 'mintly-lib'
import { daysSince, isPriceStale, staleCutoff } from './menu-item-rules'

const NOW = new Date('2026-10-28T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('menu-item-rules', () => {
  it('daysSince conta dias inteiros e nunca devolve negativo', () => {
    expect(daysSince(daysAgo(10), NOW)).toBe(10)
    expect(daysSince(daysAgo(10.9), NOW)).toBe(10)
    expect(daysSince(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(0)
  })

  it('daysSince aceita string ISO (como vem do JSON)', () => {
    expect(daysSince(daysAgo(3).toISOString(), NOW)).toBe(3)
  })

  it('o preço só pede revisão a partir de PRICE_REVIEW_ALERT_DAYS dias (~5,5 meses)', () => {
    expect(PRICE_REVIEW_ALERT_DAYS).toBe(167)
    expect(isPriceStale(daysAgo(PRICE_REVIEW_ALERT_DAYS - 1), NOW)).toBe(false)
    expect(isPriceStale(daysAgo(PRICE_REVIEW_ALERT_DAYS), NOW)).toBe(true)
    expect(isPriceStale(daysAgo(400), NOW)).toBe(true)
  })

  it('staleCutoff é a data da última revisão que ainda entra nos avisos', () => {
    expect(staleCutoff(NOW).getTime()).toBe(daysAgo(PRICE_REVIEW_ALERT_DAYS).getTime())
    expect(isPriceStale(staleCutoff(NOW), NOW)).toBe(true)
  })

  it('aceita um limite customizado', () => {
    expect(isPriceStale(daysAgo(10), NOW, 7)).toBe(true)
    expect(isPriceStale(daysAgo(10), NOW, 30)).toBe(false)
  })
})
