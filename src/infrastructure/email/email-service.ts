import { Resend } from 'resend'

export interface IEmailService {
  sendPasswordRecovery (to: string, token: string): Promise<void>
}

class ResendEmailService implements IEmailService {
  private readonly client: Resend
  private readonly from: string

  constructor () {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY não configurada no ambiente.')
    this.client = new Resend(apiKey)
    this.from = process.env.EMAIL_FROM ?? 'Mintly <noreply@mintly.app>'
  }

  async sendPasswordRecovery (to: string, token: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/auth/redefinir-senha?token=${token}`

    const { data, error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: 'Recuperação de senha — Mintly',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Recuperação de senha</h2>
          <p>Você solicitou a redefinição da sua senha no Mintly.</p>
          <p>Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong> e pode ser usado apenas uma vez.</p>
          <a href="${resetUrl}"
             style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0;">
            Redefinir senha
          </a>
          <p style="color:#666;font-size:13px;">Se você não solicitou isso, ignore este e-mail. Sua senha não será alterada.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#999;font-size:12px;">Mintly · Gestão financeira para restaurantes</p>
        </div>
      `,
    })

    if (error) {
      console.error('[RESEND] Falha ao enviar e-mail:', JSON.stringify(error))
      throw new Error(`Falha ao enviar e-mail: ${error.message}`)
    }

    console.log('[RESEND] E-mail enviado com sucesso. ID:', data?.id)
  }
}

class ConsoleEmailService implements IEmailService {
  async sendPasswordRecovery (to: string, token: string): Promise<void> {
    console.log(`[EMAIL-DEV] Recuperação de senha para ${to}`)
    console.log(`[EMAIL-DEV] Token: ${token} (válido por 1h)`)
  }
}

let _instance: IEmailService | null = null

export function getEmailService (): IEmailService {
  if (!_instance) {
    _instance = process.env.RESEND_API_KEY
      ? new ResendEmailService()
      : new ConsoleEmailService()
  }
  return _instance
}

export function setEmailService (service: IEmailService): void {
  _instance = service
}
