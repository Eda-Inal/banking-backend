import { BadRequestException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { RequestContext } from '../common/request-context/request-context';
import { TransactionType } from '../common/enums';

jest.mock('../generated/prisma/client', () => {
  class Decimal {
    private readonly value: number;
    constructor(value: number) {
      this.value = Number(value);
    }
    toString() {
      return String(this.value);
    }
  }
  return { Prisma: { Decimal } };
});

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: any;
  let fraudService: any;
  let accountValidator: any;
  let idempotencyChecker: any;
  let transactionRepository: any;
  let transactionEventWriter: any;
  let structuredLogger: any;

  const makeTx = (overrides: Record<string, any> = {}) => ({
    id: 'tx-1',
    type: 'TRANSFER',
    fromAccountId: 'from-1',
    toAccountId: 'to-1',
    amount: { toString: () => '100' },
    status: 'COMPLETED',
    referenceId: 'ref-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
    };
    fraudService = {
      evaluateTransfer: jest.fn(),
      evaluateWithdraw: jest.fn(),
      releaseTransferDailyReservation: jest.fn(),
      releaseWithdrawDailyReservation: jest.fn(),
    };
    accountValidator = {
      getAccountOrThrow: jest.fn(),
      ensureOwnedByUserOrThrow: jest.fn(),
      ensureActiveOrThrow: jest.fn(),
    };
    idempotencyChecker = {
      findExisting: jest.fn(),
      resolveExistingOrThrow: jest.fn(),
      resolveP2002Fallback: jest.fn(),
    };
    transactionRepository = {
      createPendingTransaction: jest.fn(),
      createRejectedTransaction: jest.fn(),
      decrementBalance: jest.fn(),
      incrementBalance: jest.fn(),
      markCompleted: jest.fn(),
    };
    transactionEventWriter = {
      createCompletedEvent: jest.fn(),
      createFailedFraudEvent: jest.fn(),
    };
    structuredLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    service = new TransactionsService(
      prisma,
      fraudService,
      accountValidator,
      idempotencyChecker,
      transactionRepository,
      transactionEventWriter,
      structuredLogger,
    );

    jest.spyOn(RequestContext, 'get').mockReturnValue({
      clientIpMasked: '127.0.0.1',
      userAgent: 'jest',
      traceId: 'trace-1',
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reuses existing idempotent transfer transaction', async () => {
    const existingDto: any = { id: 'tx-existing', type: TransactionType.TRANSFER };
    idempotencyChecker.findExisting.mockResolvedValue({ id: 'tx-existing' });
    idempotencyChecker.resolveExistingOrThrow.mockReturnValue(existingDto);

    const result = await service.createTransfer('u1', {
      amount: 100,
      referenceId: 'ref-1',
      fromAccountId: 'from-1',
      toAccountId: 'to-1',
    });

    expect(result).toBe(existingDto);
  });

  it('throws withdraw fraud rejection message for fraud-rejected withdraw', async () => {
    idempotencyChecker.findExisting.mockResolvedValue(null);
    idempotencyChecker.resolveExistingOrThrow.mockReturnValue(null);
    idempotencyChecker.resolveP2002Fallback.mockResolvedValue(null);
    fraudService.evaluateWithdraw.mockResolvedValue({
      decision: 'REJECT',
      reason: 'DAILY_WITHDRAW_LIMIT_EXCEEDED',
    });

    prisma.$transaction.mockImplementation(async (cb: any) => cb({}));
    transactionRepository.createRejectedTransaction.mockResolvedValue(makeTx({
      type: 'WITHDRAW',
      status: 'REJECTED',
      toAccountId: null,
    }));
    transactionEventWriter.createFailedFraudEvent.mockResolvedValue(undefined);

    await expect(
      service.createWithdraw('u1', {
        amount: 1000,
        referenceId: 'ref-w-1',
        fromAccountId: 'from-1',
      }),
    ).rejects.toThrow(
      new BadRequestException('Your daily withdrawal limit has been exceeded.'),
    );
  });

  it('throws transfer fraud rejection message for fraud-rejected transfer', async () => {
    idempotencyChecker.findExisting.mockResolvedValue(null);
    idempotencyChecker.resolveExistingOrThrow.mockReturnValue(null);
    idempotencyChecker.resolveP2002Fallback.mockResolvedValue(null);
    fraudService.evaluateTransfer.mockResolvedValue({
      decision: 'REJECT',
      reason: 'SAME_ACCOUNT_TRANSFER',
    });

    prisma.$transaction.mockImplementation(async (cb: any) => cb({}));
    transactionRepository.createRejectedTransaction.mockResolvedValue(makeTx({
      status: 'REJECTED',
      fromAccountId: 'same',
      toAccountId: 'same',
    }));
    transactionEventWriter.createFailedFraudEvent.mockResolvedValue(undefined);

    await expect(
      service.createTransfer('u1', {
        amount: 100,
        referenceId: 'ref-t-1',
        fromAccountId: 'same',
        toAccountId: 'same',
      }),
    ).rejects.toThrow(
      new BadRequestException('You cannot transfer to the same account.'),
    );
  });

  it('throws insufficient balance for withdraw when decrement does not update row', async () => {
    idempotencyChecker.findExisting.mockResolvedValue(null);
    idempotencyChecker.resolveExistingOrThrow.mockReturnValue(null);
    idempotencyChecker.resolveP2002Fallback.mockResolvedValue(null);
    fraudService.evaluateWithdraw.mockResolvedValue({ decision: 'APPROVE' });
    accountValidator.getAccountOrThrow.mockResolvedValue({
      id: 'from-1',
      customerId: 'u1',
      status: 'ACTIVE',
    });
    transactionRepository.createPendingTransaction.mockResolvedValue(
      makeTx({ type: 'WITHDRAW', toAccountId: null, status: 'PENDING' }),
    );
    transactionRepository.decrementBalance.mockResolvedValue({ count: 0 });

    prisma.$transaction.mockImplementation(async (cb: any) => cb({}));

    await expect(
      service.createWithdraw('u1', {
        amount: 200,
        referenceId: 'ref-w-2',
        fromAccountId: 'from-1',
      }),
    ).rejects.toThrow(new BadRequestException('Account balance not enough'));
  });

  it('throws insufficient balance for transfer when debit side cannot be decremented', async () => {
    idempotencyChecker.findExisting.mockResolvedValue(null);
    idempotencyChecker.resolveExistingOrThrow.mockReturnValue(null);
    idempotencyChecker.resolveP2002Fallback.mockResolvedValue(null);
    fraudService.evaluateTransfer.mockResolvedValue({ decision: 'APPROVE' });

    accountValidator.getAccountOrThrow
      .mockResolvedValueOnce({
        id: 'from-1',
        customerId: 'u1',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        id: 'to-1',
        customerId: 'u1',
        status: 'ACTIVE',
      });
    transactionRepository.createPendingTransaction.mockResolvedValue(
      makeTx({ status: 'PENDING' }),
    );
    transactionRepository.decrementBalance.mockResolvedValue({ count: 0 });
    transactionRepository.incrementBalance.mockResolvedValue(undefined);

    prisma.$transaction.mockImplementation(async (cb: any) => cb({}));

    await expect(
      service.createTransfer('u1', {
        amount: 200,
        referenceId: 'ref-t-2',
        fromAccountId: 'from-1',
        toAccountId: 'to-1',
      }),
    ).rejects.toThrow(new BadRequestException('Insufficient balance'));
  });

  it('retries transfer when transaction conflict is retryable and succeeds next attempt', async () => {
    idempotencyChecker.findExisting.mockResolvedValue(null);
    idempotencyChecker.resolveExistingOrThrow.mockReturnValue(null);
    idempotencyChecker.resolveP2002Fallback.mockResolvedValue(null);
    fraudService.evaluateTransfer.mockResolvedValue({ decision: 'APPROVE' });

    accountValidator.getAccountOrThrow
      .mockResolvedValue({
        id: 'acc',
        customerId: 'u1',
        status: 'ACTIVE',
      });
    transactionRepository.createPendingTransaction.mockResolvedValue(
      makeTx({ status: 'PENDING' }),
    );
    transactionRepository.decrementBalance.mockResolvedValue({ count: 1 });
    transactionRepository.incrementBalance.mockResolvedValue(undefined);
    transactionRepository.markCompleted.mockResolvedValue(makeTx({ id: 'tx-ok' }));
    transactionEventWriter.createCompletedEvent.mockResolvedValue(undefined);

    const retryErr = Object.assign(new Error('deadlock detected'), {
      code: 'P2034',
    });

    prisma.$transaction
      .mockRejectedValueOnce(retryErr)
      .mockImplementationOnce(async (cb: any) => cb({}));

    const result = await service.createTransfer('u1', {
      amount: 50,
      referenceId: 'ref-retry',
      fromAccountId: 'from-1',
      toAccountId: 'to-1',
    });

    expect(result.id).toBe('tx-ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(structuredLogger.warn).toHaveBeenCalledWith(
      TransactionsService.name,
      'Transfer retry due to transaction conflict',
      expect.any(Object),
    );
  });
});
