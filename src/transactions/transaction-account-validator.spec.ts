import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TransactionAccountValidator } from './transaction-account-validator';

describe('TransactionAccountValidator', () => {
  let validator: TransactionAccountValidator;
  let structuredLogger: any;

  beforeEach(() => {
    structuredLogger = {
      warn: jest.fn(),
    };
    validator = new TransactionAccountValidator(structuredLogger);
  });

  it('throws not found when account does not exist', async () => {
    const tx = {
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    await expect(
      validator.getAccountOrThrow(tx, 'acc-1', 'Transfer'),
    ).rejects.toThrow(new NotFoundException('Account not found'));
  });

  it('throws forbidden when ownership validation fails', () => {
    expect(() =>
      validator.ensureOwnedByUserOrThrow(
        'owner-user',
        'another-user',
        'Transfer',
        'acc-1',
      ),
    ).toThrow(new ForbiddenException('Account not found'));
  });

  it('throws bad request when account is not active', () => {
    expect(() =>
      validator.ensureActiveOrThrow(
        'FROZEN',
        'u1',
        'Transfer',
        'acc-1',
        'Account is not active',
      ),
    ).toThrow(new BadRequestException('Account is not active'));
  });

  it('throws bad request when balance is insufficient', () => {
    const balance = {
      lt: jest.fn().mockReturnValue(true),
      toString: jest.fn().mockReturnValue('10'),
    } as any;
    const amount = {} as any;

    expect(() =>
      validator.ensureSufficientBalanceOrThrow(
        balance,
        amount,
        'u1',
        'Withdraw',
        'acc-1',
        50,
        'Insufficient balance',
      ),
    ).toThrow(new BadRequestException('Insufficient balance'));
  });
});
