import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
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
        'Too many transfer attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest<Request & { user?: any }>();
      const userId: string | undefined = request.user?.userId;
      if (!userId) {
        return true;
      }

      const minuteWindow = Math.floor(Date.now() / 60_000);
      const key = `${KEY_PREFIX}${userId}:${minuteWindow}`;
      await this.checkLimit(key, DEFAULT_LIMIT_PER_MINUTE, userId);
      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException(
        'Service temporarily unavailable. Try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

