import { EmailService } from './email.service';

describe('EmailService', () => {
  let config: { get: jest.Mock };
  let structuredLogger: { info: jest.Mock; warn: jest.Mock };
  let smtpTransport: { send: jest.Mock };
  let sendgridTransport: { send: jest.Mock };
  let service: EmailService;

  beforeEach(() => {
    config = { get: jest.fn() };
    structuredLogger = { info: jest.fn(), warn: jest.fn() };
    smtpTransport = { send: jest.fn() };
    sendgridTransport = { send: jest.fn() };
    service = new EmailService(
      config as any,
      structuredLogger as any,
      smtpTransport as any,
      sendgridTransport as any,
    );
  });

  it('uses SMTP transport by default', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'EMAIL_ENABLED') return 'true';
      if (key === 'EMAIL_PROVIDER') return undefined;
      return undefined;
    });
    smtpTransport.send.mockResolvedValue({
      accepted: true,
      provider: 'smtp',
      messageId: 'smtp-1',
    });

    const result = await service.send({
      to: 'a@example.com',
      subject: 'hello',
      text: 'world',
    });

    expect(smtpTransport.send).toHaveBeenCalledTimes(1);
    expect(sendgridTransport.send).not.toHaveBeenCalled();
    expect(result).toEqual({
      accepted: true,
      provider: 'smtp',
      messageId: 'smtp-1',
    });
  });

  it('uses SendGrid transport when configured', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'EMAIL_ENABLED') return 'true';
      if (key === 'EMAIL_PROVIDER') return 'sendgrid';
      return undefined;
    });
    sendgridTransport.send.mockResolvedValue({
      accepted: true,
      provider: 'sendgrid',
      messageId: 'sg-1',
    });

    const result = await service.send({
      to: 'a@example.com',
      subject: 'hello',
      text: 'world',
    });

    expect(sendgridTransport.send).toHaveBeenCalledTimes(1);
    expect(smtpTransport.send).not.toHaveBeenCalled();
    expect(result).toEqual({
      accepted: true,
      provider: 'sendgrid',
      messageId: 'sg-1',
    });
  });

  it('skips sending when email is disabled', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'EMAIL_ENABLED') return 'false';
      if (key === 'EMAIL_PROVIDER') return 'smtp';
      return undefined;
    });

    const result = await service.send({
      to: 'a@example.com',
      subject: 'hello',
      text: 'world',
    });

    expect(smtpTransport.send).not.toHaveBeenCalled();
    expect(sendgridTransport.send).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: false, provider: 'disabled' });
  });
});
