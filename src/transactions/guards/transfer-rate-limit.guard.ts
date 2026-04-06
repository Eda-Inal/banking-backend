import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CONFIG_KEYS } from '../../config/config';
import { RedisService } from '../../redis/redis.service';
import { StructuredLogger } from '../../logger/structured-logger.service';

const KEY_PREFIX = 'transfer:rate:user:';
const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT_PER_MINUTE = 10;

@Injectable()
export class TransferRateLimitGuard implements CanActivate {
  private static readonly INCR_WITH_EXPIRE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  private async checkLimit(
    key: string,
    limit: number,
    userId: string,
  ): Promise<void> {
    const client = this.redis.getClient();
    const raw = await client.eval(
      TransferRateLimitGuard.INCR_WITH_EXPIRE_LUA,
      1,
      key,
      WINDOW_SECONDS.toString(),
    );
    const count = Number(raw);
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`Invalid transfer rate limit counter: ${String(raw)}`);
    }
    if (count > limit) {
      this.structuredLogger.warn(TransferRateLimitGuard.name, 'Transfer rate limit hit', {
        eventType: 'SECURITY',
        action: 'TRANSFER_RATE_LIMIT_HIT',
        userId,
        count,
        limit,
      });
      throw new HttpException(
        'Too many transaction attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const userId: string | undefined = request.user?.userId;
    const referenceIdForLog =
      typeof (request as any).body?.referenceId === 'string'
        ? (request as any).body.referenceId.trim()
        : typeof request.headers['x-reference-id'] === 'string'
          ? request.headers['x-reference-id'].trim()
          : undefined;
    if (!userId) {
      this.structuredLogger.warn(
        TransferRateLimitGuard.name,
        'Transfer rate limit skipped because request user context is missing',
        {
          eventType: 'SECURITY',
          action: 'TRANSFER_RATE_LIMIT_SKIP_MISSING_USER',
          component: TransferRateLimitGuard.name,
          fallback: 'skip_rate_limit',
          referenceId: referenceIdForLog,
        },
      );
      return true;
    }

    if (!this.redis.isReady()) {
      this.structuredLogger.warn(TransferRateLimitGuard.name, 'Redis unavailable, skipping transfer rate limit', {
        eventType: 'INFRA',
        action: 'REDIS_RATE_LIMIT_SKIP',
        userId,
        component: TransferRateLimitGuard.name,
        fallback: 'skip_rate_limit',
        referenceId: referenceIdForLog,
      });
      return true;
    }

    try {
      const limit =
        Number(
          this.config.get(CONFIG_KEYS.TRANSACTIONS_TRANSFER_RATE_LIMIT_PER_MINUTE),
        ) || DEFAULT_LIMIT_PER_MINUTE;
      const minuteWindow = Math.floor(Date.now() / 60_000);
      const key = `${KEY_PREFIX}${userId}:${minuteWindow}`;
      await this.checkLimit(key, limit, userId);
      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      this.structuredLogger.warn(
        TransferRateLimitGuard.name,
        'Transfer rate limit redis operation failed, fail-open',
        {
          eventType: 'INFRA',
          action: 'REDIS_RATE_LIMIT_OPERATION_FAILED_FAIL_OPEN',
          userId,
          component: TransferRateLimitGuard.name,
          fallback: 'fail_open_skip_rate_limit',
          referenceId: referenceIdForLog,
          error:
            err instanceof Error
              ? { message: err.message, name: err.name }
              : { message: String(err) },
        },
      );

      return true;
    }
  }
}

