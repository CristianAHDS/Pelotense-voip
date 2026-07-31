import nodemailer from 'nodemailer'
import { logger } from './logger.js'

export interface MailConfig {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  fromEmail: string
  appName: string
}

export class Mailer {
  private transporter: nodemailer.Transporter | null = null
  private config: MailConfig

  constructor(config: MailConfig) {
    this.config = config
    if (config.smtpHost) {
      this.transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser
          ? { user: config.smtpUser, pass: config.smtpPass }
          : undefined,
      })
    }
  }

  get enabled(): boolean {
    return this.transporter !== null
  }

  // Envia o e-mail de confirmação. Retorna false se o SMTP não estiver
  // configurado (nesse caso o código é apenas logado, para desenvolvimento).
  async sendConfirmationEmail(to: string, name: string, code: string): Promise<boolean> {
    if (!this.transporter) {
      logger.warn('Mailer', `SMTP não configurado. Código de confirmação para ${to}: ${code}`)
      return false
    }
    try {
      await this.transporter.sendMail({
        from: this.config.fromEmail,
        to,
        subject: `${this.config.appName} — Confirme sua conta`,
        text: `Olá ${name}! Use o código abaixo para confirmar a criação da sua conta no ${this.config.appName}:\n\n${code}\n\nSe você não solicitou isso, ignore este e-mail.`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
            <h2 style="margin-top:0">${this.config.appName}</h2>
            <p>Olá <strong>${name}</strong>! Use o código abaixo para confirmar a criação da sua conta:</p>
            <div style="font-size:32px;letter-spacing:6px;font-weight:700;padding:12px;background:#f4f4f6;border-radius:8px;text-align:center">
              ${code}
            </div>
            <p style="color:#666;font-size:13px">Se você não solicitou isso, ignore este e-mail.</p>
          </div>
        `,
      })
      return true
    } catch (err) {
      logger.error('Mailer', 'Falha ao enviar e-mail de confirmação', err)
      return false
    }
  }
}
