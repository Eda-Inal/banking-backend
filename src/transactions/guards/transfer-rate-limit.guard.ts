import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';

const KEY_PREFIX = 'transfer:rate:user:';
const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT_PER_MINUTE = 10;

@Injectable()
export class TransferRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  private async checkLimit(
    key: string,
    limit: number,
  ): Promise<void> {
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, WINDOW_SECONDS);
    }
    if (count > limit) {
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
      await this.checkLimit(key, DEFAULT_LIMIT_PER_MINUTE);
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

