import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { transactionMapper } from './transactions.mapper';
import { TransactionStatus, TransactionType } from '../common/enums';
import { getFraudRejectionMessage } from '../fraud/fraud-user-messages';

@Injectable()
export class TransactionIdempotencyChecker {
  private readonly logger = new Logger(TransactionIdempotencyChecker.name);

  constructor(private readonly prisma: PrismaService) {}

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
      this.logger.log(
        `${type} idempotent: referenceId ${referenceId}, transactionId ${existing.id}, user ${userId}`,
      );
      return transactionMapper.toResponseDto(existing);
    }

    if (
      existing.status === TransactionStatus.REJECTED &&
      existing.fraudDecision === 'REJECT'
    ) {
      this.logger.warn(
        `${type} idempotent rejected: referenceId=${referenceId}, transactionId=${existing.id}, user=${userId}`,
      );
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

    this.logger.log(
      `${type} P2002 idempotent: referenceId=${referenceId}, returned existing transactionId=${byRef.id}, user=${userId}`,
    );

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
      throw new ConflictException(
        `${type} transaction is still in progress (referenceId=${referenceId})`,
      );
    }
    throw new BadRequestException(
      `${type} transaction has unexpected status: ${byRef.status}`,
    );
  }
}

