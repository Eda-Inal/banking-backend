import { TransferFraudRule } from '../fraud-rule.interface';
import { TransferFraudCheckInput } from '../../types/transfer-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';
import { RedisService } from '../../../redis/redis.service';
import { StructuredLogger } from '../../../logger/structured-logger.service';
import type { Prisma } from '../../../generated/prisma/client';

export class TooManyTransfersInMinuteRule implements TransferFraudRule {
  name = 'TOO_MANY_TRANSFERS_IN_MINUTE';

  /** INCR + EXPIRE on first hit in one atomic eval (avoids orphan keys without TTL). */
  private static readonly INCR_MINUTE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

  constructor(
    private readonly redisService: RedisService,
    private readonly limitPerMinute: number,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async evaluate(
    input: TransferFraudCheckInput,
    _tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult | null> {

    if (!this.redisService.isReady()) {
      this.structuredLogger.warn(
        TooManyTransfersInMinuteRule.name,
        'Redis unavailable, skipping minute transfer count rule',
        {
          eventType: 'INFRA',
          action: 'REDIS_MINUTE_TRANSFER_RULE_SKIP',
          userId: input.userId,
          component: TooManyTransfersInMinuteRule.name,
          fallback: 'skip_minute_rule',
          referenceId: input.referenceId,
        },
      );
      return null;
    }

    const client = this.redisService.getClient();
    const { minuteBucket, ttlSeconds } = this.getUtcMinuteMeta();
    const key = `fraud:transfer:minute:${input.userId}:${minuteBucket}`;

    try {
      const count = Number(
        await client.eval(
          TooManyTransfersInMinuteRule.INCR_MINUTE_LUA,
          1,
          key,
          ttlSeconds.toString(),
        ),
      );

      if (Number.isFinite(count) && count > this.limitPerMinute) {
        return { decision: 'REJECT', reason: this.name };
      }

      return null;
    } catch {
      this.structuredLogger.warn(
        TooManyTransfersInMinuteRule.name,
        'Redis operation failed, skipping minute transfer count rule',
        {
          eventType: 'INFRA',
          action: 'REDIS_MINUTE_TRANSFER_RULE_OPERATION_FAILED_FAIL_OPEN',
          userId: input.userId,
          component: TooManyTransfersInMinuteRule.name,
          fallback: 'skip_minute_rule',
          referenceId: input.referenceId,
        },
      );
      return null;
    }
  }

  private getUtcMinuteMeta(): { minuteBucket: string; ttlSeconds: number } {
    const now = new Date();
    const endOfMinuteUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes() + 1,
        0,
        0,
      ),
    );
    const ttlMs = Math.max(1000, endOfMinuteUtc.getTime() - now.getTime());
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000) + 1);

    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mi = String(now.getUTCMinutes()).padStart(2, '0');

    return {
      minuteBucket: `${yyyy}${mm}${dd}${hh}${mi}`,
      ttlSeconds,
    };
  }
}