import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { getEmailService, setEmailService } from './email-service'

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend } } }))

describe('email-service', () => {
  const original = process.env.RESEND_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    setEmailService(null as any) // zera o singleton
  })

  afterEach(() => {
    if (original === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = original
    setEmailService(null as any)
  })

  it('usa ConsoleEmailService quando não há RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY
    setEmailService(null as any)
    await expect(getEmailService().sendPasswordRecovery('x@x.com', 'tok')).resolves.toBeUndefined()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('usa ResendEmailService e envia quando há RESEND_API_KEY', async () => {
    process.env.RESEND_API_KEY = 'key'
    setEmailService(null as any)
    mockSend.mockResolvedValue({ data: { id: 'abc' }, error: null })
    await getEmailService().sendPasswordRecovery('x@x.com', 'tok')
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'x@x.com', subject: expect.stringContaining('Recuperação') }))
  })

  it('lança quando o Resend retorna erro', async () => {
    process.env.RESEND_API_KEY = 'key'
    setEmailService(null as any)
    mockSend.mockResolvedValue({ data: null, error: { message: 'falhou' } })
    await expect(getEmailService().sendPasswordRecovery('x@x.com', 'tok')).rejects.toThrow(/falha/i)
  })

  it('reutiliza a mesma instância (singleton)', () => {
    delete process.env.RESEND_API_KEY
    setEmailService(null as any)
    expect(getEmailService()).toBe(getEmailService())
  })
})
