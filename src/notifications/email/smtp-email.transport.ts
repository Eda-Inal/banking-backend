import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { CONFIG_KEYS } from '../../config/config';
import { StructuredLogger } from '../../logger/structured-logger.service';
import type { EmailMessage, EmailSendResult, EmailTransport } from './email.types';

@Injectable()
export class SmtpEmailTransport implements EmailTransport {
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const transporter = this.getTransporter();
    const from = this.config.get<string>(CONFIG_KEYS.EMAIL_FROM) ?? 'no-reply@banking.local';

    const response = await transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    this.structuredLogger.info(SmtpEmailTransport.name, 'Email sent via SMTP', {
      eventType: 'EMAIL',
      action: 'SEND_SUCCESS',
      messageId: response.messageId ?? null,
      provider: 'smtp',
    });

    return {
      accepted: true,
      provider: 'smtp',
      messageId: response.messageId,
    };
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>(CONFIG_KEYS.EMAIL_SMTP_HOST);
    const port = Number.parseInt(
      this.config.get<string>(CONFIG_KEYS.EMAIL_SMTP_PORT) ?? '1025',
      10,
    );
    const user = this.config.get<string>(CONFIG_KEYS.EMAIL_SMTP_USER) ?? '';
    const pass = this.config.get<string>(CONFIG_KEYS.EMAIL_SMTP_PASS) ?? '';

    if (!host) {
      throw new Error('EMAIL_SMTP_HOST is required for SMTP email transport');
    }

    this.transporter = createTransport({
      host,
      port: Number.isFinite(port) ? port : 1025,
      secure: false,
      auth: user ? { user, pass } : undefined,
    });

    return this.transporter;
  }
}
