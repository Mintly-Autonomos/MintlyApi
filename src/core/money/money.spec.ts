import { describe, it, expect } from 'vitest'
import { Decimal128 } from 'mongodb'
import {
  toCents,
  fromCents,
  centsToDecimal128,
  toDecimal128,
  decimalToNumber,
  computeFeeNet,
} from './money'

describe('money', () => {
  describe('toCents / fromCents', () => {
    it('converte valor com 2 casas para centavos inteiros (sem float)', () => {
      expect(toCents(99.99)).toBe(9999)
      expect(toCents(0.1)).toBe(10)
      expect(toCents(100)).toBe(10000)
    })

    it('não perde 1 centavo em bordas com ruído de float (ex.: 0.615 → 62)', () => {
      // 0.615*100 = 61.4999999… — Math.round(value*100) daria 61 (errado).
      expect(toCents(0.615)).toBe(62)
      expect(toCents(1.005)).toBe(101)
    })

    it('volta de centavos para valor', () => {
      expect(fromCents(9999)).toBe(99.99)
      expect(fromCents(10000)).toBe(100)
    })
  })

  describe('centsToDecimal128 / toDecimal128', () => {
    it('formata Decimal128 com 2 casas', () => {
      expect(centsToDecimal128(9990).toString()).toBe('99.90')
      expect(centsToDecimal128(5).toString()).toBe('0.05')
      expect(centsToDecimal128(10000).toString()).toBe('100.00')
    })

    it('preserva sinal negativo (débito de saldo)', () => {
      expect(centsToDecimal128(-2500).toString()).toBe('-25.00')
    })

    it('toDecimal128 passa por centavos sem float residual', () => {
      expect(toDecimal128(99.99).toString()).toBe('99.99')
      expect(toDecimal128(0.1).toString()).toBe('0.10')
    })
  })

  describe('decimalToNumber', () => {
    it('converte Decimal128/number/null para number', () => {
      expect(decimalToNumber(Decimal128.fromString('12.34'))).toBe(12.34)
      expect(decimalToNumber(50)).toBe(50)
      expect(decimalToNumber(null)).toBe(0)
      expect(decimalToNumber(undefined)).toBe(0)
    })
  })

  describe('computeFeeNet', () => {
    it('conta platform: fee = bruto * percent / 100, net = bruto - fee', () => {
      expect(computeFeeNet(100, 12)).toEqual({ feeValue: 12, netValue: 88 })
    })

    it('arredonda a taxa ao centavo', () => {
      // 99.99 * 12% = 11.9988 -> 12.00 (arredondado), net = 87.99
      expect(computeFeeNet(99.99, 12)).toEqual({ feeValue: 12, netValue: 87.99 })
    })

    it('sem feePercent (conta não-platform): fee 0, net = bruto', () => {
      expect(computeFeeNet(150.5)).toEqual({ feeValue: 0, netValue: 150.5 })
    })

    it('feePercent 0: fee 0, net = bruto', () => {
      expect(computeFeeNet(80, 0)).toEqual({ feeValue: 0, netValue: 80 })
    })
  })
})
