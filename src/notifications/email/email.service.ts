import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from '../../config/config';
import { StructuredLogger } from '../../logger/structured-logger.service';
import { SendgridEmailTransport } from './sendgrid-email.transport';
import { SmtpEmailTransport } from './smtp-email.transport';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email.types';

@Injectable()
export class EmailService {
  constructor(
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
    private readonly smtpTransport: SmtpEmailTransport,
    private readonly sendgridTransport: SendgridEmailTransport,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const enabled = this.parseBoolean(
      this.config.get<string>(CONFIG_KEYS.EMAIL_ENABLED),
      true,
    );

    if (!enabled) {
      this.structuredLogger.warn(EmailService.name, 'Email sending is disabled', {
        eventType: 'EMAIL',
        action: 'SEND_SKIPPED_DISABLED',
      });
      return { accepted: false, provider: 'disabled' };
    }

    const provider = this.resolveProvider(
      this.config.get<string>(CONFIG_KEYS.EMAIL_PROVIDER),
    );

    this.structuredLogger.info(EmailService.name, 'Email send requested', {
      eventType: 'EMAIL',
      action: 'SEND_REQUEST',
      provider,
      subject: message.subject,
    });

    return provider === 'sendgrid'
      ? this.sendgridTransport.send(message)
      : this.smtpTransport.send(message);
  }

  private resolveProvider(value: string | undefined): EmailProvider {
    return value === 'sendgrid' ? 'sendgrid' : 'smtp';
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return fallback;
  }
}
