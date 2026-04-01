import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { transactionMapper } from './transactions.mapper';
import { TransactionStatus, TransactionType } from '../common/enums';
import { getFraudRejectionMessage } from '../fraud/fraud-user-messages';
import { StructuredLogger } from '../logger/structured-logger.service';

@Injectable()
export class TransactionIdempotencyChecker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async findExisting(
    userId: string,
    type: TransactionType,
    referenceId: string,
  ) {
    return this.prisma.transaction.findFirst({
      where: { actorCustomerId: userId, type, referenceId },
    });
  }

  resolveExistingOrThrow(params: {
    existing: Awaited<ReturnType<TransactionIdempotencyChecker['findExisting']>>;
    referenceId: string;
    userId: string;
    type: TransactionType;
  }): TransactionResponseDto | null {
    const { existing, referenceId, userId, type } = params;
    if (!existing) return null;

    if (existing.status === TransactionStatus.COMPLETED) {
      this.structuredLogger.info(TransactionIdempotencyChecker.name, 'Idempotent completed transaction reused', {
        eventType: 'TRANSACTION',
        action: type,
        referenceId,
        transactionId: existing.id,
        userId,
        status: 'COMPLETED',
      });
      return transactionMapper.toResponseDto(existing);
    }

    if (
      existing.status === TransactionStatus.REJECTED &&
      existing.fraudDecision === 'REJECT'
    ) {
      this.structuredLogger.warn(TransactionIdempotencyChecker.name, 'Idempotent rejected transaction reused', {
        eventType: 'TRANSACTION',
        action: type,
        referenceId,
        transactionId: existing.id,
        userId,
        status: 'REJECTED',
      });
      throw new BadRequestException(
        getFraudRejectionMessage(type, existing.fraudReason ?? undefined),
      );
    }

    return null;
  }

  async resolveP2002Fallback(params: {
    err: unknown;
    userId: string;
    referenceId: string;
    type: TransactionType;
  }): Promise<TransactionResponseDto | null> {
    const { err, userId, referenceId, type } = params;
    const isP2002 =
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002';
    if (!isP2002) return null;

    const byRef = await this.findExisting(userId, type, referenceId);
    if (!byRef) return null;

    this.structuredLogger.info(TransactionIdempotencyChecker.name, 'P2002 fallback reused existing transaction', {
      eventType: 'TRANSACTION',
      action: type,
      referenceId,
      transactionId: byRef.id,
      userId,
      code: 'P2002',
    });

    if (byRef.status === TransactionStatus.COMPLETED) {
      return transactionMapper.toResponseDto(byRef);
    }

    if (
      byRef.status === TransactionStatus.REJECTED &&
      byRef.fraudDecision === 'REJECT'
    ) {
      throw new BadRequestException(
        getFraudRejectionMessage(type, byRef.fraudReason ?? undefined),
      );
    }

    if (byRef.status === TransactionStatus.PENDING) {
      this.structuredLogger.warn(
        TransactionIdempotencyChecker.name,
        'P2002 fallback found pending transaction',
        {
          eventType: 'TRANSACTION',
          action: type,
          referenceId,
          transactionId: byRef.id,
          userId,
          status: 'PENDING',
        },
      );
      throw new ConflictException(
        `${type} transaction is still in progress (referenceId=${referenceId})`,
      );
    }
    this.structuredLogger.warn(
      TransactionIdempotencyChecker.name,
      'P2002 fallback found unexpected transaction status',
      {
        eventType: 'TRANSACTION',
        action: type,
        referenceId,
        transactionId: byRef.id,
        userId,
        status: byRef.status,
      },
    );
    throw new BadRequestException(
      `${type} transaction has unexpected status: ${byRef.status}`,
    );
  }
}

