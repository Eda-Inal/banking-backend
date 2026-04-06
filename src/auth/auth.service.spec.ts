import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestContext } from '../common/request-context/request-context';
import { AccountLockedException } from './exceptions/account-locked.exception';
import * as bcrypt from 'bcrypt';
import { CONFIG_KEYS } from '../config/config';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../generated/prisma/client', () => ({
  Prisma: {
    sql: jest.fn(),
  },
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let config: any;
  let audit: any;
  let structuredLogger: any;

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
    };
    config = {
      get: jest.fn((key: string) => {
        if (key === CONFIG_KEYS.JWT_REFRESH_EXPIRES_IN) return '3600';
        if (key === CONFIG_KEYS.JWT_ACCESS_EXPIRES_IN) return '900';
        if (key === CONFIG_KEYS.LOGIN_LOCK_THRESHOLD) return '5';
        if (key === CONFIG_KEYS.LOGIN_LOCK_DURATION_MINUTES) return '15';
        return undefined;
      }),
    };
    audit = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    structuredLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    service = new AuthService(
      prisma,
      jwtService,
      config,
      audit,
      structuredLogger,
    );

    jest.spyOn(RequestContext, 'get').mockReturnValue({
      clientIpMasked: '127.0.0.1',
      userAgent: 'jest',
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws conflict when register email already exists', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'u1' });

    await expect(
      service.register({
        email: 'existing@example.com',
        password: 'Passw0rd',
        name: 'User',
        phone: '5555555555',
      }),
    ).rejects.toThrow(new ConflictException('Customer already exists'));
  });

  it('throws invalid credentials when login email is not found', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'Passw0rd' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('throws invalid credentials when login password is invalid', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u@example.com',
      passwordHash: 'hash',
      lockUntil: null,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    prisma.$queryRaw.mockResolvedValue([
      { failed_login_attempts: 1, lock_until: null },
    ]);

    await expect(
      service.login({ email: 'u@example.com', password: 'wrong-pass' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('throws account locked exception when account lockUntil is in future', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u@example.com',
      passwordHash: 'hash',
      lockUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.login({ email: 'u@example.com', password: 'Passw0rd' }),
    ).rejects.toThrow(AccountLockedException);
  });

  it('returns tokens and persists refresh token on successful login', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const createMock = jest.fn().mockResolvedValue({ id: 'rt1' });

    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u@example.com',
      name: 'User',
      passwordHash: 'hash',
      lockUntil: null,
    });
    prisma.customer.update.mockResolvedValue(undefined);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        refreshToken: {
          updateMany: updateManyMock,
          create: createMock,
        },
      }),
    );

    const result = await service.login({
      email: 'u@example.com',
      password: 'Passw0rd',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeDefined();
    expect(result.tokenType).toBe('Bearer');
    expect(result.user.id).toBe('u1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        customerId: 'u1',
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'u1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
    });
  });

  it('throws invalid refresh token when refresh cookie is missing', async () => {
    await expect(service.refresh({ cookies: {} } as any)).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token'),
    );
  });

  it('throws invalid refresh token when token is not found', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(
      service.refresh({ cookies: { refreshToken: 'raw-token' } } as any),
    ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
  });

  it('throws invalid refresh token when refresh token is reused', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-old',
      customerId: 'u1',
      customer: { id: 'u1', email: 'u@example.com', name: 'User' },
    });
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        refreshToken: {
          create: jest.fn().mockResolvedValue({ id: 'rt-new' }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    await expect(
      service.refresh({ cookies: { refreshToken: 'raw-token' } } as any),
    ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
  });

  it('returns logged out when refresh cookie does not exist', async () => {
    await expect(service.logout({ cookies: {} } as any)).resolves.toEqual({
      message: 'Logged out',
    });
  });

  it('revokes refresh token and returns logged out when refresh cookie exists', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      customerId: 'u1',
      revokedAt: null,
    });
    prisma.refreshToken.update.mockResolvedValue({ id: 'rt1' });

    await expect(
      service.logout({ cookies: { refreshToken: 'raw-token' } } as any),
    ).resolves.toEqual({ message: 'Logged out' });

    expect(prisma.refreshToken.update).toHaveBeenCalled();
    expect(audit.recordSuccess).toHaveBeenCalled();
  });
});
