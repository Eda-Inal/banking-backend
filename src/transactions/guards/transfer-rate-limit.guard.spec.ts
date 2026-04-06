import { ExecutionContext, HttpException } from '@nestjs/common';
import { TransferRateLimitGuard } from './transfer-rate-limit.guard';

describe('TransferRateLimitGuard', () => {
  let guard: TransferRateLimitGuard;
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
      eval: jest.fn(),
    };
    redis = {
      isReady: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(redisClient),
    };
    config = {
      get: jest.fn().mockReturnValue('10'),
    };
    structuredLogger = {
      warn: jest.fn(),
    };
    guard = new TransferRateLimitGuard(redis, config, structuredLogger);
  });

  it('returns true when user context is missing', async () => {
    const request = { headers: {}, body: {} };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(redis.getClient).not.toHaveBeenCalled();
  });

  it('returns true when redis is unavailable (fail-open)', async () => {
    redis.isReady.mockReturnValue(false);
    const request = { user: { userId: 'u1' }, headers: {}, body: {} };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('throws 429 when rate limit is exceeded', async () => {
    redisClient.eval.mockResolvedValue(11);
    const request = { user: { userId: 'u1' }, headers: {}, body: {} };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new HttpException('Too many transaction attempts. Try again later.', 429),
    );
  });
});
import { ExecutionContext, HttpException } from '@nestjs/common';
import { TransferRateLimitGuard } from './transfer-rate-limit.guard';

describe('TransferRateLimitGuard', () => {
  let guard: TransferRateLimitGuard;
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
      eval: jest.fn(),
    };
    redis = {
      isReady: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(redisClient),
    };
    config = {
      get: jest.fn().mockReturnValue('10'),
    };
    structuredLogger = {
      warn: jest.fn(),
    };
    guard = new TransferRateLimitGuard(redis, config, structuredLogger);
  });

  it('returns true when user context is missing', async () => {
    const request = { headers: {}, body: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(redis.getClient).not.toHaveBeenCalled();
  });

  it('returns true when redis is unavailable (fail-open)', async () => {
    redis.isReady.mockReturnValue(false);
    const request = { user: { userId: 'u1' }, headers: {}, body: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('throws 429 when rate limit is exceeded', async () => {
    redisClient.eval.mockResolvedValue(11);
    const request = { user: { userId: 'u1' }, headers: {}, body: {} };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new HttpException(
        'Too many transaction attempts. Try again later.',
        429,
      ),
    );
  });
});
