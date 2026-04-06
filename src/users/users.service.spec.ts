import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import * as bcrypt from 'bcrypt';
import { RequestContext } from '../common/request-context/request-context';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let audit: any;
  let structuredLogger: any;

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    audit = {
      recordSuccess: jest.fn(),
    };
    structuredLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    service = new UsersService(prisma, audit, structuredLogger);

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

  it('throws not found when getMe user does not exist', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(service.getMe('u1')).rejects.toThrow(
      new NotFoundException('User not found'),
    );
  });

  it('maps P2002 to conflict exception in putMe', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u@example.com',
      name: 'User',
      phone: '5555555555',
    });
    const err = new Error('unique violation') as Error & { code?: string };
    err.code = 'P2002';
    prisma.customer.update.mockRejectedValue(err);

    await expect(
      service.putMe('u1', { email: 'dup@example.com' }),
    ).rejects.toThrow(new ConflictException('Email already exists'));
  });

  it('throws invalid credentials when old password is incorrect', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.patchPassword('u1', {
        oldPassword: 'WrongPass1',
        newPassword: 'NewPass1',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('throws bad request when new password is same as old password', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.patchPassword('u1', {
        oldPassword: 'SamePass1',
        newPassword: 'SamePass1',
      }),
    ).rejects.toThrow(
      new BadRequestException('New password cannot be the same as the old password'),
    );
  });

  it('updates password and revokes refresh tokens on successful patchPassword', async () => {
    const customerUpdateMock = jest.fn().mockResolvedValue({ id: 'u1' });
    const refreshUpdateManyMock = jest.fn().mockResolvedValue({ count: 2 });

    prisma.customer.findUnique.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        customer: {
          update: customerUpdateMock,
        },
        refreshToken: {
          updateMany: refreshUpdateManyMock,
        },
      }),
    );

    await expect(
      service.patchPassword('u1', {
        oldPassword: 'OldPass1',
        newPassword: 'NewPass1',
      }),
    ).resolves.toEqual({ message: 'Password updated successfully' });

    expect(customerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(refreshUpdateManyMock).toHaveBeenCalledWith({
      where: {
        customerId: 'u1',
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(audit.recordSuccess).toHaveBeenCalled();
  });
});
