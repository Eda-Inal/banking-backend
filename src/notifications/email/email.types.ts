export type EmailProvider = 'smtp' | 'sendgrid';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  accepted: boolean;
  provider: EmailProvider | 'disabled';
  messageId?: string;
};

export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
