import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from '../../config/config';
import type { EmailMessage, EmailSendResult, EmailTransport } from './email.types';

@Injectable()
export class SendgridEmailTransport implements EmailTransport {
  constructor(private readonly config: ConfigService) {}

  async send(_message: EmailMessage): Promise<EmailSendResult> {
    const apiKey = this.config.get<string>(CONFIG_KEYS.SENDGRID_API_KEY);
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY is required for SendGrid transport');
    }

    throw new Error('SendGrid transport is not implemented yet');
  }
}
