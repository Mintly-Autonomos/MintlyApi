import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { getEmailService, setEmailService, GmailEmailService } from './email-service'

const mockSendMail = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}))

describe('email-service', () => {
  const originalGmailUser = process.env.GMAIL_USER
  const originalGmailPass = process.env.GMAIL_APP_PASSWORD

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    setEmailService(null as any) // zera o singleton
  })

  afterEach(() => {
    if (originalGmailUser === undefined) delete process.env.GMAIL_USER
    else process.env.GMAIL_USER = originalGmailUser
    if (originalGmailPass === undefined) delete process.env.GMAIL_APP_PASSWORD
    else process.env.GMAIL_APP_PASSWORD = originalGmailPass
    setEmailService(null as any)
  })

  it('usa ConsoleEmailService quando não há GMAIL_USER/GMAIL_APP_PASSWORD', async () => {
    await expect(getEmailService().sendPasswordRecovery('x@x.com', 'tok')).resolves.toBeUndefined()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('usa GmailEmailService quando há GMAIL_USER/GMAIL_APP_PASSWORD', async () => {
    process.env.GMAIL_USER = 'conta@gmail.com'
    process.env.GMAIL_APP_PASSWORD = 'senha-de-app'
    setEmailService(null as any)
    mockSendMail.mockResolvedValue({ messageId: 'abc' })
    await getEmailService().sendPasswordRecovery('x@x.com', 'tok')
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'x@x.com', subject: expect.stringContaining('Recuperação') }),
    )
  })

  it('lança quando o Gmail falha ao enviar', async () => {
    process.env.GMAIL_USER = 'conta@gmail.com'
    process.env.GMAIL_APP_PASSWORD = 'senha-de-app'
    setEmailService(null as any)
    mockSendMail.mockRejectedValue(new Error('conexão recusada'))
    await expect(getEmailService().sendPasswordRecovery('x@x.com', 'tok')).rejects.toThrow(/falha/i)
  })

  it('GmailEmailService lança se GMAIL_USER/GMAIL_APP_PASSWORD não estiverem setados', () => {
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    expect(() => new GmailEmailService()).toThrow(/GMAIL_USER/)
  })

  it('reutiliza a mesma instância (singleton)', () => {
    setEmailService(null as any)
    expect(getEmailService()).toBe(getEmailService())
  })
})
