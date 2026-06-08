export interface IEmailService {
  sendPasswordRecovery (to: string, token: string): Promise<void>
}

class ConsoleEmailService implements IEmailService {
  async sendPasswordRecovery (to: string, token: string): Promise<void> {
    // Em produção, substituir por SMTP real (nodemailer, SES, etc.)
    console.log(`[EMAIL] Recuperação de senha para ${to}: token=${token} (válido por 1h)`)
  }
}

let _instance: IEmailService | null = null

export function getEmailService (): IEmailService {
  if (!_instance) _instance = new ConsoleEmailService()
  return _instance
}

export function setEmailService (service: IEmailService): void {
  _instance = service
}
