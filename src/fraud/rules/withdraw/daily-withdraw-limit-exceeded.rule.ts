import { Prisma } from '../../../generated/prisma/client';
import { RedisService } from '../../../redis/redis.service';
import { WithdrawFraudRule } from '../fraud-rule.interface';
import { WithdrawFraudCheckInput } from '../../types/withdraw-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';
import { PrismaService } from '../../../prisma/prisma.service';
import { TransactionStatus, TransactionType } from '../../../common/enums';
import { StructuredLogger } from '../../../logger/structured-logger.service';

export class DailyWithdrawLimitExceededRule implements WithdrawFraudRule {
  name = 'DAILY_WITHDRAW_LIMIT_EXCEEDED';
  private static readonly RESERVE_LUA = `
local totalKey = KEYS[1]
local refKey = KEYS[2]
local amount = tonumber(ARGV[1])
local dailyLimit = tonumber(ARGV[2])
local totalTtlSec = tonumber(ARGV[3])
local refTtlSec = tonumber(ARGV[4])

if not amount or not dailyLimit or not totalTtlSec or not refTtlSec then
  return {err="invalid_args"}
end

if redis.call('EXISTS', refKey) == 1 then
  local currentTotal = tonumber(redis.call('GET', totalKey) or '0')
  return {1, currentTotal}
end

local currentTotal = tonumber(redis.call('GET', totalKey) or '0')
local nextTotal = currentTotal + amount

if nextTotal > dailyLimit then
  return {0, currentTotal}
end

redis.call('SET', totalKey, tostring(nextTotal), 'EX', totalTtlSec)
redis.call('SET', refKey, tostring(amount), 'EX', refTtlSec)
return {1, nextTotal}
`;
  private static readonly RELEASE_LUA = `
local totalKey = KEYS[1]
local refKey = KEYS[2]
local releasedKey = KEYS[3]
local fallbackTotalTtlSec = tonumber(ARGV[1])
local releasedTtlSec = tonumber(ARGV[2])

if not fallbackTotalTtlSec or not releasedTtlSec then
  return {err="invalid_args"}
end

if redis.call('EXISTS', releasedKey) == 1 then
  return {1, 0}
end

if redis.call('EXISTS', refKey) == 0 then
  redis.call('SET', releasedKey, '1', 'EX', releasedTtlSec)
  return {1, 0}
end

local reservedAmount = tonumber(redis.call('GET', refKey) or '0')
local currentTotal = tonumber(redis.call('GET', totalKey) or '0')
local nextTotal = currentTotal - reservedAmount
if nextTotal < 0 then
  nextTotal = 0
end

local pttl = redis.call('PTTL', totalKey)
if pttl > 0 then
  redis.call('PSETEX', totalKey, pttl, tostring(nextTotal))
else
  redis.call('SET', totalKey, tostring(nextTotal), 'EX', fallbackTotalTtlSec)
end

redis.call('DEL', refKey)
redis.call('SET', releasedKey, '1', 'EX', releasedTtlSec)
return {1, nextTotal}
`;

  constructor(
    private readonly redis: RedisService,
    private readonly dailyLimit: number,
    private readonly prisma: PrismaService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async evaluate(
    input: WithdrawFraudCheckInput,
    _tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult | null> {
    const client = this.redis.getClient();
    const { dayBucket, ttlSeconds } = this.getUtcDayMeta();
    const totalKey = `fraud:withdraw:daily:${input.userId}:${dayBucket}`;
    const refKey = `fraud:withdraw:daily:ref:${input.userId}:${dayBucket}:${input.referenceId}`;
    const amount = input.amount.toString();
    const refTtlSeconds = ttlSeconds + 3600;

    try {
      const result = (await client.eval(
        DailyWithdrawLimitExceededRule.RESERVE_LUA,
        2,
        totalKey,
        refKey,
        amount,
        this.dailyLimit.toString(),
        ttlSeconds.toString(),
        refTtlSeconds.toString(),
      )) as [number, number] | null;

      const allowed = Array.isArray(result) ? Number(result[0]) === 1 : false;
      if (!allowed) {
        return {
          decision: 'REJECT',
          reason: this.name,
        };
      }
      return null;
    } catch (err) {
      this.structuredLogger.warn(
        DailyWithdrawLimitExceededRule.name,
        'Redis unavailable, using fallback',
        {
          eventType: 'INFRA',
          action: 'REDIS_FALLBACK',
          component: DailyWithdrawLimitExceededRule.name,
          fallback: 'db_query',
          userId: input.userId,
          referenceId: input.referenceId,
          error:
            err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
        },
      );
      try {
        return await this.evaluateFromDb(input);
      } catch {
        return { decision: 'REJECT', reason: this.name };
      }
    }
  }

  private async evaluateFromDb(
    input: WithdrawFraudCheckInput,
  ): Promise<FraudDecisionResult | null> {
    const { startOfDayUtc, endOfDayUtc } = this.getUtcDayRange();

    const agg = await this.prisma.transaction.aggregate({
      where: {
        actorCustomerId: input.userId,
        type: TransactionType.WITHDRAW,
        status: TransactionStatus.COMPLETED,
        createdAt: {
          gte: startOfDayUtc,
          lt: endOfDayUtc,
        },
      },
      _sum: { amount: true },
    });

    const usedToday = agg._sum.amount ?? new Prisma.Decimal(0);
    const projectedTotal = usedToday.add(input.amount);

    if (projectedTotal.gt(this.dailyLimit)) {
      return { decision: 'REJECT', reason: this.name };
    }

    return null;
  }

  async releaseReservation(input: WithdrawFraudCheckInput): Promise<void> {
    const { dayBucket, ttlSeconds } = this.getUtcDayMeta();
    const totalKey = `fraud:withdraw:daily:${input.userId}:${dayBucket}`;
    const refKey = `fraud:withdraw:daily:ref:${input.userId}:${dayBucket}:${input.referenceId}`;
    const releasedKey = `fraud:withdraw:daily:released:${input.userId}:${dayBucket}:${input.referenceId}`;
    const releasedTtlSeconds = ttlSeconds + 3600;

    try {
      const client = this.redis.getClient();
      await client.eval(
        DailyWithdrawLimitExceededRule.RELEASE_LUA,
        3,
        totalKey,
        refKey,
        releasedKey,
        ttlSeconds.toString(),
        releasedTtlSeconds.toString(),
      );
    } catch (err) {
      this.structuredLogger.warn(
        DailyWithdrawLimitExceededRule.name,
        'Withdraw daily reservation release failed, best-effort skip',
        {
          eventType: 'INFRA',
          action: 'RELEASE_WITHDRAW_RESERVATION_FAILED',
          component: DailyWithdrawLimitExceededRule.name,
          fallback: 'best_effort_skip_release',
          userId: input.userId,
          referenceId: input.referenceId,
          error:
            err instanceof Error
              ? { message: err.message, name: err.name }
              : { message: String(err) },
        },
      );
    }
  }

  private getUtcDayMeta(): { dayBucket: string; ttlSeconds: number } {
    const now = new Date();
    const endOfDayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
    );
    const ttlMs = Math.max(1000, endOfDayUtc.getTime() - now.getTime());
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');

    return {
      dayBucket: `${yyyy}${mm}${dd}`,
      ttlSeconds,
    };
  }

  private getUtcDayRange(): { startOfDayUtc: Date; endOfDayUtc: Date } {
    const now = new Date();
    const startOfDayUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDayUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      ),
    );
    return { startOfDayUtc, endOfDayUtc };
  }
}