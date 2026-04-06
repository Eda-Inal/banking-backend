import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
} from '@nestjs/common';
import { TransactionsIdempotencyGuard } from './transactions-idempotency.guard';

describe('TransactionsIdempotencyGuard', () => {
  let guard: TransactionsIdempotencyGuard;
  let redis: any;
  let config: any;
  let structuredLogger: any;
  let redisClient: any;

  const makeContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    redisClient = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };
    redis = {
      isReady: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(redisClient),
    };
    config = {
      get: jest.fn().mockReturnValue('180'),
    };
    structuredLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };
    guard = new TransactionsIdempotencyGuard(redis, config, structuredLogger);
  });

  it('returns true when user context is missing', async () => {
    const request = {
      headers: {},
      body: {},
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(redis.getClient).not.toHaveBeenCalled();
  });

  it('throws bad request when header and body referenceId mismatch', async () => {
    const request = {
      user: { userId: 'u1' },
      headers: { 'x-reference-id': 'ref-header' },
      body: { referenceId: 'ref-body', toAccountId: 'to-1' },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new BadRequestException('referenceId in header and body must match'),
    );
  });

  it('throws bad request when referenceId is missing', async () => {
    const request = {
      user: { userId: 'u1' },
      headers: {},
      body: { toAccountId: 'to-1' },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new BadRequestException('Missing referenceId'),
    );
  });

  it('sets idempotency request fields for a fresh deposit request', async () => {
    redisClient.set.mockResolvedValue('OK');
    const request: any = {
      user: { userId: 'u1' },
      headers: {},
      body: { referenceId: 'ref-1', toAccountId: 'to-1' },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.idempotencyKey).toBe(
      'transactions:idempotency:u1:deposit:ref-1',
    );
    expect(request.idempotencyReferenceId).toBe('ref-1');
    expect(request.idempotencyOperation).toBe('deposit');
  });

  it('throws conflict when same request is in-flight', async () => {
    redisClient.set.mockResolvedValue(null);
    redisClient.get.mockResolvedValue('in-flight');
    const request = {
      user: { userId: 'u1' },
      headers: { 'x-reference-id': 'ref-1' },
      body: { toAccountId: 'to-1' },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new ConflictException('Duplicate request in progress'),
    );
  });

  it('throws transfer lock conflict when transfer user lock is already taken', async () => {
    redisClient.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);
    const request: any = {
      user: { userId: 'u1' },
      headers: { 'x-reference-id': 'ref-transfer-1' },
      body: { fromAccountId: 'from-1', toAccountId: 'to-1' },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new ConflictException('Another transfer is already in progress'),
    );
    expect(redisClient.del).toHaveBeenCalledWith(
      'transactions:idempotency:u1:transfer:ref-transfer-1',
    );
  });

  it('returns true when redis operation fails (fail-open path)', async () => {
    redisClient.set.mockRejectedValue(new Error('redis down'));
    const request = {
      user: { userId: 'u1' },
      headers: { 'x-reference-id': 'ref-redis-fail' },
      body: { toAccountId: 'to-1' },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });
});
