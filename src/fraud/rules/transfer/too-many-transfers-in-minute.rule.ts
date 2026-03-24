import { TransferFraudRule } from '../fraud-rule.interface';
import { TransferFraudCheckInput } from '../../types/transfer-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';
import { RedisService } from '../../../redis/redis.service';

export class TooManyTransfersInMinuteRule implements TransferFraudRule {
  name = 'TOO_MANY_TRANSFERS_IN_MINUTE';

  constructor(
    private readonly redisService: RedisService,
    private readonly limitPerMinute: number,
  ) {}

  async evaluate(input: TransferFraudCheckInput): Promise<FraudDecisionResult | null> {
    const client = this.redisService.getClient();
    const minuteBucket = this.getMinuteBucket();
    const key = `fraud:transfer:minute:${input.userId}:${minuteBucket}`;

    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, 70);
    }

    if (count > this.limitPerMinute) {
      return { decision: 'REJECT', reason: this.name };
    }

    return null;
  }

  private getMinuteBucket(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mi = String(now.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${mi}`;
    }
}