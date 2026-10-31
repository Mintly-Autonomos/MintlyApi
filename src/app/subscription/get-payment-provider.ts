import type { PaymentProvider } from './payment-provider'
import { MockPaymentProvider } from './mock-payment-provider'
import { MercadoPagoPaymentProvider } from './mercadopago-payment-provider'

/**
 * Escolhe o provedor pela variável PAYMENT_PROVIDER (`mock` | `mercadopago`).
 *
 * Falha FECHADA: sem a variável, só o ambiente de desenvolvimento/teste cai no simulado. Em produção
 * (e na Vercel, que força NODE_ENV=production até em staging) é preciso escolher explicitamente, porque
 * o simulado aprova pagamentos sem cobrar ninguém.
 */
export function getPaymentProvider (env: Record<string, string | undefined> = process.env): PaymentProvider {
  const chosen = env.PAYMENT_PROVIDER?.trim().toLowerCase()

  if (chosen === 'mock') return new MockPaymentProvider()
  if (chosen === 'mercadopago') {
    if (!env.MP_ACCESS_TOKEN) throw new Error('PAYMENT_PROVIDER=mercadopago exige MP_ACCESS_TOKEN.')
    return new MercadoPagoPaymentProvider()
  }
  if (!chosen && env.NODE_ENV !== 'production') return new MockPaymentProvider()

  throw new Error(chosen
    ? `PAYMENT_PROVIDER inválido: "${chosen}". Use "mock" ou "mercadopago".`
    : 'PAYMENT_PROVIDER não configurado. Defina "mock" (teste) ou "mercadopago".')
}
