import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class TransactionAccountValidator {
  private readonly logger = new Logger(TransactionAccountValidator.name);

  async getAccountOrThrow(
    tx: Prisma.TransactionClient,
    accountId: string,
    logContext: string,
  ) {
    const account = await tx.account.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      this.logger.warn(`${logContext}: account not found accountId=${accountId}`);
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
      this.logger.warn(
        `${logContext}: forbidden, accountId=${accountId} not owned by user=${userId}`,
      );
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
      this.logger.warn(
        `${logContext}: account not active accountId=${accountId}, status=${accountStatus}, user=${userId}`,
      );
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
      this.logger.warn(
        `${logContext}: account balance not enough accountId=${accountId}, balance=${balance}, amount=${rawAmount}, user=${userId}`,
      );
      throw new BadRequestException(message);
    }
  }
}

