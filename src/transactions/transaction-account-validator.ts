import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { StructuredLogger } from '../logger/structured-logger.service';

@Injectable()
export class TransactionAccountValidator {
  constructor(private readonly structuredLogger: StructuredLogger) {}

  async getAccountOrThrow(
    tx: Prisma.TransactionClient,
    accountId: string,
    logContext: string,
  ) {
    const account = await tx.account.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      this.structuredLogger.warn(TransactionAccountValidator.name, 'Account not found', {
        eventType: 'TRANSACTION',
        action: 'ACCOUNT_VALIDATE',
        logContext,
        accountId,
      });
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  ensureOwnedByUserOrThrow(
    accountCustomerId: string,
    userId: string,
    logContext: string,
    accountId: string,
  ) {
    if (accountCustomerId !== userId) {
      this.structuredLogger.warn(TransactionAccountValidator.name, 'Account ownership validation failed', {
        eventType: 'TRANSACTION',
        action: 'ACCOUNT_VALIDATE',
        logContext,
        accountId,
        userId,
      });
      throw new ForbiddenException('Account not found');
    }
  }

  ensureActiveOrThrow(
    accountStatus: string,
    userId: string,
    logContext: string,
    accountId: string,
    message: string,
  ) {
    if (accountStatus !== 'ACTIVE') {
      this.structuredLogger.warn(TransactionAccountValidator.name, 'Account active-state validation failed', {
        eventType: 'TRANSACTION',
        action: 'ACCOUNT_VALIDATE',
        logContext,
        accountId,
        accountStatus,
        userId,
      });
      throw new BadRequestException(message);
    }
  }

  ensureSufficientBalanceOrThrow(
    balance: Prisma.Decimal,
    amount: Prisma.Decimal,
    userId: string,
    logContext: string,
    accountId: string,
    rawAmount: number,
    message: string,
  ) {
    if (balance.lt(amount)) {
      this.structuredLogger.warn(TransactionAccountValidator.name, 'Insufficient balance', {
        eventType: 'TRANSACTION',
        action: 'ACCOUNT_VALIDATE',
        logContext,
        accountId,
        balance: balance.toString(),
        amount: rawAmount,
        userId,
      });
      throw new BadRequestException(message);
    }
  }
}

