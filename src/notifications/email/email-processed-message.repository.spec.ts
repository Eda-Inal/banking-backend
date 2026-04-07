jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { EmailProcessedMessageRepository } from './email-processed-message.repository';

describe('EmailProcessedMessageRepository', () => {
  it('claims with dedicated consumer name to avoid audit collisions', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ claimed: 1 }]);
    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: jest.fn(),
    };
    const config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'RABBITMQ_CONSUMER_CLAIM_TTL_MS') return '300000';
        return undefined;
      }),
    };
    const structuredLogger = { error: jest.fn() };

    const repo = new EmailProcessedMessageRepository(
      prisma as any,
      config as any,
      structuredLogger as any,
    );

    const claimed = await repo.claim('msg-1', 'TRANSACTION_COMPLETED');
    expect(claimed).toBe(true);

    const allValues = queryRaw.mock.calls[0].slice(1);
    expect(allValues).toContain('banking-backend-email');
    expect(allValues).not.toContain('banking-backend');
  });
});
