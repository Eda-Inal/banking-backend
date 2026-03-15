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

const KEY_PREFIX_IP = 'login:ip:';
const KEY_PREFIX_EMAIL = 'login:email:';
const WINDOW_SECONDS = 120;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private getClientIp(req: Request): string {
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private async checkLimit(
    client: ReturnType<RedisService['getClient']>,
    key: string,
    limit: number,
  ): Promise<void> {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, WINDOW_SECONDS);
    }
    if (count > limit) {
      throw new HttpException(
        'Too many login attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest<Request>();
      const ip = this.getClientIp(request);
      const minuteWindow = Math.floor(Date.now() / 60_000);
      const client = this.redis.getClient();

      const ipLimit =
        Number(this.config.get(CONFIG_KEYS.LOGIN_RATE_LIMIT_IP_PER_MINUTE)) ||
        20;
      const ipKey = `${KEY_PREFIX_IP}${ip}:${minuteWindow}`;
      await this.checkLimit(client, ipKey, ipLimit);

      const email =
        typeof request.body?.email === 'string'
          ? request.body.email.trim().toLowerCase()
          : '';
      if (email) {
        const emailLimit =
          Number(
            this.config.get(CONFIG_KEYS.LOGIN_RATE_LIMIT_EMAIL_PER_MINUTE),
          ) || 10;
        const emailKey = `${KEY_PREFIX_EMAIL}${email}:${minuteWindow}`;
        await this.checkLimit(client, emailKey, emailLimit);
      }

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
