import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransactionIdempotencyChecker } from './transaction-idempotency-checker';
import { TransactionStatus, TransactionType } from '../common/enums';
import { Prisma } from '../generated/prisma/client';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('TransactionIdempotencyChecker', () => {
  let checker: TransactionIdempotencyChecker;
  let prisma: any;
  let structuredLogger: any;

  const makeTx = (overrides: Record<string, any> = {}) => ({
    id: 'tx-1',
    type: TransactionType.TRANSFER,
    actorCustomerId: 'u1',
    fromAccountId: 'from-1',
    toAccountId: 'to-1',
    amount: new Prisma.Decimal(100),
    status: TransactionStatus.COMPLETED,
    referenceId: 'ref-1',
    fraudDecision: null,
    fraudReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      transaction: {
        findFirst: jest.fn(),
      },
    };
    structuredLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    checker = new TransactionIdempotencyChecker(prisma, structuredLogger);
  });

  it('reuses existing COMPLETED result', () => {
    const existing = makeTx({
      status: TransactionStatus.COMPLETED,
      type: 'TRANSFER',
    });

    const result = checker.resolveExistingOrThrow({
      existing,
      referenceId: 'ref-1',
      userId: 'u1',
      type: TransactionType.TRANSFER,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'tx-1',
        status: TransactionStatus.COMPLETED,
        referenceId: 'ref-1',
      }),
    );
  });

  it('maps existing REJECTED fraud result to user-facing message', () => {
    const existing = makeTx({
      status: TransactionStatus.REJECTED,
      type: 'TRANSFER',
      fraudDecision: 'REJECT',
      fraudReason: 'SAME_ACCOUNT_TRANSFER',
    });

    expect(() =>
      checker.resolveExistingOrThrow({
        existing,
        referenceId: 'ref-1',
        userId: 'u1',
        type: TransactionType.TRANSFER,
      }),
    ).toThrow(new BadRequestException('You cannot transfer to the same account.'));
  });

  it('throws conflict for P2002 fallback when status is PENDING', async () => {
    prisma.transaction.findFirst.mockResolvedValue(
      makeTx({ status: TransactionStatus.PENDING }),
    );
    const err = new Error('unique') as Error & { code?: string };
    err.code = 'P2002';

    await expect(
      checker.resolveP2002Fallback({
        err,
        userId: 'u1',
        referenceId: 'ref-1',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toThrow(
      new ConflictException('Transaction request is still in progress'),
    );
  });

  it('throws generic bad request for P2002 fallback with unexpected status', async () => {
    prisma.transaction.findFirst.mockResolvedValue(
      makeTx({ status: TransactionStatus.FAILED }),
    );
    const err = new Error('unique') as Error & { code?: string };
    err.code = 'P2002';

    await expect(
      checker.resolveP2002Fallback({
        err,
        userId: 'u1',
        referenceId: 'ref-1',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toThrow(
      new BadRequestException('Transaction request could not be processed'),
    );
  });

  it('handles P2002 fallback by status (completed, rejected, pending)', async () => {
    const err = new Error('unique') as Error & { code?: string };
    err.code = 'P2002';

    prisma.transaction.findFirst.mockResolvedValueOnce(
      makeTx({ status: TransactionStatus.COMPLETED }),
    );
    await expect(
      checker.resolveP2002Fallback({
        err,
        userId: 'u1',
        referenceId: 'ref-c',
        type: TransactionType.TRANSFER,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: TransactionStatus.COMPLETED }),
    );

    prisma.transaction.findFirst.mockResolvedValueOnce(
      makeTx({
        status: TransactionStatus.REJECTED,
        fraudDecision: 'REJECT',
        fraudReason: 'SAME_ACCOUNT_TRANSFER',
      }),
    );
    await expect(
      checker.resolveP2002Fallback({
        err,
        userId: 'u1',
        referenceId: 'ref-r',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toThrow(
      new BadRequestException('You cannot transfer to the same account.'),
    );

    prisma.transaction.findFirst.mockResolvedValueOnce(
      makeTx({ status: TransactionStatus.PENDING }),
    );
    await expect(
      checker.resolveP2002Fallback({
        err,
        userId: 'u1',
        referenceId: 'ref-p',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toThrow(
      new ConflictException('Transaction request is still in progress'),
    );
  });
});
