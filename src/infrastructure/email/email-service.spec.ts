import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { getEmailService, setEmailService, ResendEmailService, GmailEmailService } from './email-service'

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend } } }))

const mockSendMail = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}))

describe('email-service', () => {
  const originalResend = process.env.RESEND_API_KEY
  const originalGmailUser = process.env.GMAIL_USER
  const originalGmailPass = process.env.GMAIL_APP_PASSWORD

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.RESEND_API_KEY
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    setEmailService(null as any) // zera o singleton
  })

  afterEach(() => {
    if (originalResend === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalResend
    if (originalGmailUser === undefined) delete process.env.GMAIL_USER
    else process.env.GMAIL_USER = originalGmailUser
    if (originalGmailPass === undefined) delete process.env.GMAIL_APP_PASSWORD
    else process.env.GMAIL_APP_PASSWORD = originalGmailPass
    setEmailService(null as any)
  })

  it('usa ConsoleEmailService quando não há RESEND_API_KEY nem GMAIL_USER/GMAIL_APP_PASSWORD', async () => {
    await expect(getEmailService().sendPasswordRecovery('x@x.com', 'tok')).resolves.toBeUndefined()
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
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

  it('usa GmailEmailService quando há GMAIL_USER/GMAIL_APP_PASSWORD (sem RESEND_API_KEY)', async () => {
    process.env.GMAIL_USER = 'conta@gmail.com'
    process.env.GMAIL_APP_PASSWORD = 'senha-de-app'
    setEmailService(null as any)
    mockSendMail.mockResolvedValue({ messageId: 'abc' })
    await getEmailService().sendPasswordRecovery('x@x.com', 'tok')
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'x@x.com', subject: expect.stringContaining('Recuperação') }),
    )
  })

  it('prioriza Resend sobre Gmail quando ambos estão configurados', async () => {
    process.env.RESEND_API_KEY = 'key'
    process.env.GMAIL_USER = 'conta@gmail.com'
    process.env.GMAIL_APP_PASSWORD = 'senha-de-app'
    setEmailService(null as any)
    mockSend.mockResolvedValue({ data: { id: 'abc' }, error: null })
    await getEmailService().sendPasswordRecovery('x@x.com', 'tok')
    expect(mockSend).toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('lança quando o Gmail falha ao enviar', async () => {
    process.env.GMAIL_USER = 'conta@gmail.com'
    process.env.GMAIL_APP_PASSWORD = 'senha-de-app'
    setEmailService(null as any)
    mockSendMail.mockRejectedValue(new Error('conexão recusada'))
    await expect(getEmailService().sendPasswordRecovery('x@x.com', 'tok')).rejects.toThrow(/falha/i)
  })

  it('ResendEmailService lança se RESEND_API_KEY não estiver setada', () => {
    delete process.env.RESEND_API_KEY
    expect(() => new ResendEmailService()).toThrow(/RESEND_API_KEY/)
  })

  it('GmailEmailService lança se GMAIL_USER/GMAIL_APP_PASSWORD não estiverem setados', () => {
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    expect(() => new GmailEmailService()).toThrow(/GMAIL_USER/)
  })

  it('reutiliza a mesma instância (singleton)', () => {
    delete process.env.RESEND_API_KEY
    setEmailService(null as any)
    expect(getEmailService()).toBe(getEmailService())
  })
})
