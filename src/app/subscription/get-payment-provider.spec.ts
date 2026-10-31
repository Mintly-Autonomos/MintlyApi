import { describe, it, expect } from 'vitest'
import { getPaymentProvider } from './get-payment-provider'

const env = (vars: Record<string, string | undefined>) => vars as Record<string, string | undefined>

describe('getPaymentProvider (escolha pelo ambiente)', () => {
  it('PAYMENT_PROVIDER=mock usa o simulado', () => {
    expect(getPaymentProvider(env({ PAYMENT_PROVIDER: 'mock', NODE_ENV: 'production' })).name).toBe('mock')
  })

  it('PAYMENT_PROVIDER=mercadopago com token usa o Mercado Pago', () => {
    expect(getPaymentProvider(env({ PAYMENT_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'TEST-123' })).name).toBe('mercadopago')
  })

  it('aceita maiúsculas e espaços na variável', () => {
    expect(getPaymentProvider(env({ PAYMENT_PROVIDER: '  MOCK ' })).name).toBe('mock')
  })

  it('mercadopago SEM token falha: não existe cobrança real sem credencial', () => {
    expect(() => getPaymentProvider(env({ PAYMENT_PROVIDER: 'mercadopago' }))).toThrow('MP_ACCESS_TOKEN')
  })

  it('sem a variável, desenvolvimento e teste caem no simulado', () => {
    expect(getPaymentProvider(env({ NODE_ENV: 'development' })).name).toBe('mock')
    expect(getPaymentProvider(env({})).name).toBe('mock')
  })

  it('FALHA FECHADA: sem a variável em produção não cai no simulado (ele aprovaria sem cobrar)', () => {
    expect(() => getPaymentProvider(env({ NODE_ENV: 'production' }))).toThrow('PAYMENT_PROVIDER não configurado')
  })

  it('valor desconhecido é recusado, em qualquer ambiente', () => {
    expect(() => getPaymentProvider(env({ PAYMENT_PROVIDER: 'stripe' }))).toThrow('PAYMENT_PROVIDER inválido')
    expect(() => getPaymentProvider(env({ PAYMENT_PROVIDER: 'stripe', NODE_ENV: 'development' }))).toThrow('inválido')
  })
})
