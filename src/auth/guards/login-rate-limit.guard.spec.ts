import { AccountLockedException } from '../exceptions/account-locked.exception';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

jest.mock('../../generated/prisma/client', () => ({
  Prisma: {
    sql: jest.fn(),
  },
}));

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('LoginRateLimitGuard', () => {
  let guard: LoginRateLimitGuard;
  let redis: any;
  let config: any;
  let structuredLogger: any;
  let prisma: any;
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
      get: jest.fn((key: string) => {
        if (key === 'LOGIN_RATE_LIMIT_IP_PER_MINUTE') return '20';
        if (key === 'LOGIN_RATE_LIMIT_EMAIL_PER_MINUTE') return '10';
        return undefined;
      }),
    };
    structuredLogger = {
      warn: jest.fn(),
    };
    prisma = {
      customer: {
        findUnique: jest.fn(),
      },
    };

    guard = new LoginRateLimitGuard(redis, config, structuredLogger, prisma);
  });

  it('returns true when redis is unavailable and email is empty', async () => {
    redis.isReady.mockReturnValue(false);
    const request = { ip: '127.0.0.1', body: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('throws account locked when redis is unavailable and db shows lockUntil', async () => {
    redis.isReady.mockReturnValue(false);
    prisma.customer.findUnique.mockResolvedValue({
      lockUntil: new Date(Date.now() + 60_000),
    });
    const request = { ip: '127.0.0.1', body: { email: 'user@example.com' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      AccountLockedException,
    );
  });

  it('throws 429 when redis counters exceed threshold', async () => {
    redisClient.eval.mockResolvedValue(21);
    const request = { ip: '127.0.0.1', body: { email: 'user@example.com' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new HttpException('Too many login attempts. Try again later.', 429),
    );
  });

  it('throws 429 when email threshold is exceeded', async () => {
    redisClient.eval
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(11);
    const request = { ip: '127.0.0.1', body: { email: 'user@example.com' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      new HttpException('Too many login attempts. Try again later.', 429),
    );
  });
});
