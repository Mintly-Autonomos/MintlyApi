import { Decimal128 } from 'mongodb'

/**
 * Helpers de dinheiro (MIN-49/50).
 *
 * Decisão (a spec citava "Decimal128 via sapphire-bson", mas sapphire-bson só
 * gera validator de collection — não faz Decimal128): o dinheiro é persistido
 * como **Decimal128** (driver do mongo) e a acumulação de saldo é feita com
 * `$inc` de Decimal128 (aritmética decimal exata server-side, na transação).
 *
 * O cálculo de fee/net é feito em **centavos inteiros** para não passar por
 * float em nenhum momento; só então vira Decimal128.
 */

/** Valor monetário (ex.: 99.9) → centavos inteiros (9990). */
export function toCents (value: number): number {
  // Arredonda a 4 casas antes de truncar p/ centavos: remove o ruído de float do
  // produto (ex.: 1.005*100 = 100.4999999) que arredondaria 1 centavo p/ menos.
  return Math.round(Number((value * 100).toFixed(4)))
}

/** Centavos inteiros (9990) → valor monetário (99.9). */
export function fromCents (cents: number): number {
  return cents / 100
}

/** Centavos inteiros → Decimal128 com 2 casas (ex.: 9990 → Decimal128("99.90")). */
export function centsToDecimal128 (cents: number): Decimal128 {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const reais = Math.trunc(abs / 100)
  const centavos = String(abs % 100).padStart(2, '0')
  return Decimal128.fromString(`${sign}${reais}.${centavos}`)
}

/** Valor monetário → Decimal128 (passa por centavos, sem float residual). */
export function toDecimal128 (value: number): Decimal128 {
  return centsToDecimal128(toCents(value))
}

/** Decimal128 (ou number/string vindos do banco) → number de exibição. */
export function decimalToNumber (value: Decimal128 | number | string | null | undefined): number {
  if (value == null) return 0
  return typeof value === 'number' ? value : Number(value.toString())
}

export interface FeeBreakdown {
  feeValue: number
  netValue: number
}

/**
 * Calcula taxa e líquido a partir do bruto e do percentual (inteiro, da conta
 * `platform`). Sem conta platform (feePercent ausente): fee 0, net = bruto.
 *   feeValue = grossValue * feePercent / 100   (arredondado ao centavo)
 *   netValue = grossValue - feeValue
 */
export function computeFeeNet (grossValue: number, feePercent?: number): FeeBreakdown {
  const grossCents = toCents(grossValue)

  if (feePercent === undefined || feePercent === null) {
    return { feeValue: 0, netValue: fromCents(grossCents) }
  }

  const feeCents = Math.round((grossCents * feePercent) / 100)
  const netCents = grossCents - feeCents
  return { feeValue: fromCents(feeCents), netValue: fromCents(netCents) }
}
