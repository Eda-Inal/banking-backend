import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { RequestContext } from '../common/request-context/request-context';
import { AccountStatus } from '../common/enums';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../generated/prisma/client', () => {
  class Decimal {
    private readonly value: number;
    constructor(value: number) {
      this.value = Number(value);
    }
    eq(other: { value?: number } | number): boolean {
      const v = typeof other === 'number' ? other : Number((other as any).value);
      return this.value === v;
    }
    toString(): string {
      return String(this.value);
    }
  }
  return { Prisma: { Decimal } };
});

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: any;
  let structuredLogger: any;

  const makeAccount = (overrides: Record<string, any> = {}) => ({
    id: 'acc-1',
    balance: { toString: () => '0', eq: (d: any) => Number(d?.value ?? d) === 0 },
    currency: 'USD',
    status: AccountStatus.ACTIVE,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    customerId: 'u1',
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      account: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };
    structuredLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    service = new AccountsService(prisma, structuredLogger);

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

  it('throws conflict on duplicate account creation', async () => {
    prisma.account.findFirst.mockResolvedValue(makeAccount());

    await expect(
      service.createAccount('u1', { currency: 'USD' as any }),
    ).rejects.toThrow(new ConflictException('You already have an account with USD'));
  });

  it('throws not found when freeze target account does not exist', async () => {
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    prisma.account.findFirst.mockResolvedValue(null);

    await expect(service.freezeAccount('u1', 'acc-x')).rejects.toThrow(
      new NotFoundException('Account not found'),
    );
  });

  it('throws already frozen when freeze is requested for frozen account', async () => {
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    prisma.account.findFirst.mockResolvedValue(
      makeAccount({ status: AccountStatus.FROZEN }),
    );

    await expect(service.freezeAccount('u1', 'acc-1')).rejects.toThrow(
      new BadRequestException('Account is already frozen'),
    );
  });

  it('throws not found when unfreeze target account does not exist', async () => {
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    prisma.account.findFirst.mockResolvedValue(null);

    await expect(service.unfreezeAccount('u1', 'acc-x')).rejects.toThrow(
      new NotFoundException('Account not found'),
    );
  });

  it('throws already active when unfreeze is requested for active account', async () => {
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    prisma.account.findFirst.mockResolvedValue(
      makeAccount({ status: AccountStatus.ACTIVE }),
    );

    await expect(service.unfreezeAccount('u1', 'acc-1')).rejects.toThrow(
      new BadRequestException('Account is already active'),
    );
  });

  it('throws not found when close target account does not exist', async () => {
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    prisma.account.findFirst.mockResolvedValue(null);

    await expect(service.closeAccount('u1', 'acc-x')).rejects.toThrow(
      new NotFoundException('Account not found'),
    );
  });

  it('throws non-zero balance rejection when closing account with balance', async () => {
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    prisma.account.findFirst.mockResolvedValue(
      makeAccount({
        status: AccountStatus.ACTIVE,
        balance: { toString: () => '10', eq: () => false },
      }),
    );

    await expect(service.closeAccount('u1', 'acc-1')).rejects.toThrow(
      new BadRequestException('Account balance must be zero to close account'),
    );
  });
});
