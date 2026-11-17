import nodemailer, { Transporter } from 'nodemailer'

/** Dados do convite de funcionário para o texto do e-mail (E.1). */
export interface MemberInviteEmail {
  memberName: string
  restaurantName: string
  expiresInDays: number
}

export interface IEmailService {
  sendPasswordRecovery (to: string, token: string): Promise<void>
  sendMemberInvite (to: string, token: string, invite: MemberInviteEmail): Promise<void>
}

const frontendUrl = () => process.env.FRONTEND_URL ?? 'http://localhost:4200'
const inviteUrl = (token: string) => `${frontendUrl()}/auth/aceitar-convite?token=${token}`

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] as string)

function buildInviteEmailHtml (url: string, invite: MemberInviteEmail): string {
  const nome = escapeHtml(invite.memberName)
  const restaurante = escapeHtml(invite.restaurantName || 'um restaurante')
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">Você foi convidado para o Mintly</h2>
      <p>Olá, ${nome}. Você recebeu acesso à gestão financeira de <strong>${restaurante}</strong> no Mintly.</p>
      <p>Clique no botão abaixo para criar sua senha. O link vale por <strong>${invite.expiresInDays} dias</strong> e pode ser usado uma vez só.</p>
      <a href="${url}"
         style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0;">
        Criar minha senha
      </a>
      <p style="color:#666;font-size:13px;">Se você não esperava este convite, ignore este e-mail.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#999;font-size:12px;">Mintly · Gestão financeira para restaurantes</p>
    </div>
  `
}

function buildRecoveryEmailHtml (resetUrl: string): string {
  return `
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
  `
}

/**
 * Envia via SMTP do Gmail (App Password — não a senha normal da conta).
 * Gratuito, sem verificação de domínio; limite de ~500 e-mails/dia por conta.
 */
export class GmailEmailService implements IEmailService {
  private readonly transporter: Transporter
  private readonly from: string

  constructor () {
    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) throw new Error('GMAIL_USER/GMAIL_APP_PASSWORD não configurados no ambiente.')
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
    this.from = process.env.EMAIL_FROM ?? `Mintly <${user}>`
  }

  async sendPasswordRecovery (to: string, token: string): Promise<void> {
    const resetUrl = `${frontendUrl()}/auth/redefinir-senha?token=${token}`

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Recuperação de senha — Mintly',
        html: buildRecoveryEmailHtml(resetUrl),
      })
      console.log('[GMAIL] E-mail enviado com sucesso. ID:', info.messageId)
    } catch (error) {
      console.error('[GMAIL] Falha ao enviar e-mail:', error)
      throw new Error(`Falha ao enviar e-mail: ${(error as Error).message}`)
    }
  }

  async sendMemberInvite (to: string, token: string, invite: MemberInviteEmail): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: `Convite para ${invite.restaurantName || 'o Mintly'} — Mintly`,
        html: buildInviteEmailHtml(inviteUrl(token), invite),
      })
      console.log('[GMAIL] Convite enviado. ID:', info.messageId)
    } catch (error) {
      console.error('[GMAIL] Falha ao enviar convite:', error)
      throw new Error(`Falha ao enviar e-mail: ${(error as Error).message}`)
    }
  }
}

class ConsoleEmailService implements IEmailService {
  async sendPasswordRecovery (to: string, token: string): Promise<void> {
    console.log(`[EMAIL-DEV] Recuperação de senha para ${to}`)
    console.log(`[EMAIL-DEV] Token: ${token} (válido por 1h)`)
  }

  async sendMemberInvite (to: string, token: string, invite: MemberInviteEmail): Promise<void> {
    console.log(`[EMAIL-DEV] Convite de funcionário para ${to} (${invite.restaurantName})`)
    console.log(`[EMAIL-DEV] Link: ${inviteUrl(token)} (válido por ${invite.expiresInDays} dias)`)
  }
}

let _instance: IEmailService | null = null

export function getEmailService (): IEmailService {
  if (!_instance) {
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      _instance = new GmailEmailService()
    } else if (process.env.NODE_ENV === 'production') {
      // Em produção, cair no ConsoleEmailService seria um vazamento: a recuperação
      // "teria sucesso" sem enviar nada e ainda logaria o token em claro. Falha alto.
      throw new Error('Serviço de e-mail não configurado em produção (defina GMAIL_USER/GMAIL_APP_PASSWORD).')
    } else {
      // Fora de produção: sem SMTP, imprime o link no console (única forma de
      // testar recuperação localmente). Inacessível em produção pelo guard acima.
      _instance = new ConsoleEmailService()
    }
  }
  return _instance
}

export function setEmailService (service: IEmailService): void {
  _instance = service
}
