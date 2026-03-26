import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { TransactionStatus, TransactionType } from '../common/enums';

@Injectable()
export class TransactionRepository {
  async createPendingTransaction(params: {
    tx: Prisma.TransactionClient;
    type: TransactionType;
    actorCustomerId: string;
    fromAccountId: string | null;
    toAccountId: string | null;
    amount: number;
    referenceId: string;
  }) {
    const { tx, ...rest } = params;
    return tx.transaction.create({
      data: {
        ...rest,
        status: TransactionStatus.PENDING,
      },
    });
  }

  async createRejectedTransaction(params: {
    tx: Prisma.TransactionClient;
    type: TransactionType;
    actorCustomerId: string;
    fromAccountId: string | null;
    toAccountId: string | null;
    amount: number;
    referenceId: string;
    fraudDecision: 'REJECT';
    fraudReason?: string;
  }) {
    const { tx, ...rest } = params;
    return tx.transaction.create({
      data: {
        ...rest,
        status: TransactionStatus.REJECTED,
      },
    });
  }

  async markCompleted(tx: Prisma.TransactionClient, transactionId: string) {
    return tx.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.COMPLETED },
    });
  }

  async incrementBalance(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: number,
  ) {
    await tx.account.update({
      where: { id: accountId },
      data: { balance: { increment: amount } },
    });
  }

  async decrementBalance(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: number,
  ) {
    return tx.account.updateMany({
      where: {
        id: accountId,
        balance: { gte: amount },
      },
      data: { balance: { decrement: amount } },
    });
  }
}

