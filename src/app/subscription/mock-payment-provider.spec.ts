import { describe, it, expect, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { MockPaymentProvider } from './mock-payment-provider'
import type { PaymentRepository } from './payment-repository'

describe('MockPaymentProvider', () => {
  it('a cobrança aponta para a tela de simulação do próprio app', async () => {
    const provider = new MockPaymentProvider({} as PaymentRepository, 'https://app.mintly.test/')
    const out = await provider.createCheckout({ paymentId: 'abc123', env: 'staging', title: 't', amountCents: 15000 })
    expect(out).toEqual({ providerReference: 'abc123', checkoutUrl: 'https://app.mintly.test/assinatura/simulador?pagamento=abc123' })
  })

  it('getPayment devolve o que a pessoa decidiu no simulador', async () => {
    const id = new ObjectId()
    const payments = { findById: vi.fn().mockResolvedValue({ _id: id, amountCents: 42750, mockDecision: 'approved' }) } as unknown as PaymentRepository
    const out = await new MockPaymentProvider(payments, 'http://x').getPayment(String(id), 'staging')
    expect(out).toEqual({ id: String(id), status: 'approved', amountCents: 42750, externalReference: String(id) })
  })

  it('sem decisão ainda, o pagamento está pendente', async () => {
    const id = new ObjectId()
    const payments = { findById: vi.fn().mockResolvedValue({ _id: id, amountCents: 100 }) } as unknown as PaymentRepository
    expect((await new MockPaymentProvider(payments, 'http://x').getPayment(String(id), 'staging')).status).toBe('pending')
  })

  it('pagamento inexistente dá 404', async () => {
    const payments = { findById: vi.fn().mockResolvedValue(null) } as unknown as PaymentRepository
    await expect(new MockPaymentProvider(payments, 'http://x').getPayment('x', 'staging')).rejects.toThrow()
  })
})
