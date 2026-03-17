import { TransactionResponseDto } from './dto/transaction-response.dto';
import type { Transaction } from '../generated/prisma/client';
import { TransactionType, TransactionStatus } from '../common/enums';

export const transactionMapper = {
  toResponseDto(tx: Transaction): TransactionResponseDto {
    if (!Object.values(TransactionType).includes(tx.type as TransactionType)) {
      throw new Error(`Invalid transaction type: ${tx.type}`);
    }
    if (!Object.values(TransactionStatus).includes(tx.status as TransactionStatus)) {
      throw new Error(`Invalid transaction status: ${tx.status}`);
    }
    return {
      id: tx.id,
      type: tx.type as TransactionType,
      fromAccountId: tx.fromAccountId ?? null,
      toAccountId: tx.toAccountId ?? null,
      amount: tx.amount.toString(),
      status: tx.status as TransactionStatus,
      referenceId: tx.referenceId,
      createdAt: tx.createdAt,
    };
  },
};
