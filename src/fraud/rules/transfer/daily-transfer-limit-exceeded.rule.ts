import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TransferFraudRule } from '../fraud-rule.interface';
import { TransferFraudCheckInput } from '../../types/transfer-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';
import { TransactionStatus, TransactionType } from '../../../common/enums';

export class DailyTransferLimitExceededRule implements TransferFraudRule {
  name = 'DAILY_TRANSFER_LIMIT_EXCEEDED';

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyLimit: number,
  ) {}

  async evaluate(input: TransferFraudCheckInput): Promise<FraudDecisionResult | null> {
    const { startOfDayUtc, endOfDayUtc } = this.getUtcDayRange();

    const aggregate = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        type: TransactionType.TRANSFER,
        status: TransactionStatus.COMPLETED,
        fromAccount: {
          customerId: input.userId,
        },
        createdAt: {
          gte: startOfDayUtc,
          lt: endOfDayUtc,
        },
      },
    });

    const dailyTotal = aggregate._sum.amount ?? new Prisma.Decimal(0);
    const nextTotal = dailyTotal.plus(input.amount);

    if (nextTotal.gt(this.dailyLimit)) {
      return {
        decision: 'REJECT',
        reason: this.name,
      };
    }

    return null;
  }

  private getUtcDayRange(): { startOfDayUtc: Date; endOfDayUtc: Date } {
    const now = new Date();
    const startOfDayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const endOfDayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
    );

    return { startOfDayUtc, endOfDayUtc };
  }
}