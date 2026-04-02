import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { CONFIG_KEYS } from '../../config/config';
import { RedisService } from '../../redis/redis.service';
import { StructuredLogger } from '../../logger/structured-logger.service';
import { getClientIpMasked } from '../http/client-context';

const KEY_PREFIX = 'global:rate:ip:';
const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT_PER_MINUTE = 100;

@Injectable()
export class GlobalRateLimitMiddleware implements NestMiddleware {
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

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = getClientIpMasked(req) ?? 'unknown';

    if (!this.redis.isReady()) {
      this.structuredLogger.warn(
        GlobalRateLimitMiddleware.name,
        'Redis unavailable, skipping global rate limit',
        {
          eventType: 'INFRA',
          action: 'GLOBAL_RATE_LIMIT_REDIS_SKIP',
          component: GlobalRateLimitMiddleware.name,
          fallback: 'skip_global_rate_limit',
          ip,
        },
      );
      next();
      return;
    }

    try {
      const limit =
        Number(this.config.get(CONFIG_KEYS.GLOBAL_RATE_LIMIT_PER_MINUTE)) ||
        DEFAULT_LIMIT_PER_MINUTE;

      const minuteWindow = Math.floor(Date.now() / 60_000);
      const key = `${KEY_PREFIX}${ip}:${minuteWindow}`;
      const client = this.redis.getClient();

      const raw = await client.eval(
        GlobalRateLimitMiddleware.INCR_WITH_EXPIRE_LUA,
        1,
        key,
        WINDOW_SECONDS.toString(),
      );

      const count = Number(raw);
      if (!Number.isFinite(count) || count < 1) {
        throw new Error(`Invalid global rate limit counter: ${String(raw)}`);
      }

      if (count > limit) {
        this.structuredLogger.warn(
          GlobalRateLimitMiddleware.name,
          'Global rate limit hit',
          {
            eventType: 'SECURITY',
            action: 'GLOBAL_RATE_LIMIT_HIT',
            component: GlobalRateLimitMiddleware.name,
            ip,
            count,
            limit,
          },
        );
        res.status(429).json({ message: 'Too many requests. Try again later.' });
        return;
      }

      next();
    } catch (err) {
      this.structuredLogger.warn(
        GlobalRateLimitMiddleware.name,
        'Global rate limit redis operation failed, fail-open',
        {
          eventType: 'INFRA',
          action: 'GLOBAL_RATE_LIMIT_OPERATION_FAILED_FAIL_OPEN',
          component: GlobalRateLimitMiddleware.name,
          fallback: 'skip_global_rate_limit',
          ip,
          error:
            err instanceof Error
              ? { message: err.message, name: err.name }
              : { message: String(err) },
        },
      );
      next();
    }
  }
}
