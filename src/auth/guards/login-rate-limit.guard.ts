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
import { PrismaService } from '../../prisma/prisma.service';
import { AccountLockedException } from '../exceptions/account-locked.exception';

const KEY_PREFIX_IP = 'login:ip:';
const KEY_PREFIX_EMAIL = 'login:email:';
const WINDOW_SECONDS = 120;

const maskEmailForLog = (email: string): string => {
  const normalized = email.trim().toLowerCase();
  const [localPart, domainPart] = normalized.split('@');
  if (!localPart || !domainPart) return '***';

  const maskedLocal = `${localPart[0] ?? '*'}***`;
  const domainParts = domainPart.split('.');
  const root = domainParts[0];
  const suffix = domainParts.slice(1).join('.');
  const maskedRoot = `${root?.[0] ?? '*'}***`;

  return suffix ? `${maskedLocal}@${maskedRoot}.${suffix}` : `${maskedLocal}@${maskedRoot}`;
};

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
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
    private readonly prisma: PrismaService,
  ) {}

  private getClientIp(req: Request): string {
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private async checkLimit(
    client: ReturnType<RedisService['getClient']>,
    key: string,
    limit: number,
    details: { ip: string; email?: string },
  ): Promise<void> {
    const raw = await client.eval(
      LoginRateLimitGuard.INCR_WITH_EXPIRE_LUA,
      1,
      key,
      WINDOW_SECONDS.toString(),
    );
    const count = Number(raw);
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`Invalid login rate limit counter: ${String(raw)}`);
    }
    if (count > limit) {
      this.structuredLogger.warn(LoginRateLimitGuard.name, 'Login rate limit hit', {
        eventType: 'SECURITY',
        action: 'LOGIN_RATE_LIMIT_HIT',
        ip: details.ip,
        emailMasked: details.email ? maskEmailForLog(details.email) : null,
        count,
        limit,
      });
      throw new HttpException(
        'Too many login attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);
    const minuteWindow = Math.floor(Date.now() / 60_000);

    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';

    if (!this.redis.isReady()) {
      this.structuredLogger.warn(LoginRateLimitGuard.name, 'Redis unavailable, falling back to DB account lock check', {
        eventType: 'INFRA',
        action: 'LOGIN_RATE_LIMIT_REDIS_UNAVAILABLE_DB_FALLBACK',
        component: LoginRateLimitGuard.name,
        fallback: 'db_account_lock_check',
        ip,
        emailMasked: email ? maskEmailForLog(email) : null,
      });
      return this.checkDbAccountLock(email);
    }

    const client = this.redis.getClient();
    try {
      const ipLimit =
        Number(this.config.get(CONFIG_KEYS.LOGIN_RATE_LIMIT_IP_PER_MINUTE)) ||
        20;
      const ipKey = `${KEY_PREFIX_IP}${ip}:${minuteWindow}`;
      await this.checkLimit(client, ipKey, ipLimit, { ip });

      if (email) {
        const emailLimit =
          Number(
            this.config.get(CONFIG_KEYS.LOGIN_RATE_LIMIT_EMAIL_PER_MINUTE),
          ) || 10;
        const emailKey = `${KEY_PREFIX_EMAIL}${email}:${minuteWindow}`;
        await this.checkLimit(client, emailKey, emailLimit, { ip, email });
      }

      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      this.structuredLogger.warn(LoginRateLimitGuard.name, 'Redis operation failed, falling back to DB account lock check', {
        eventType: 'INFRA',
        action: 'LOGIN_RATE_LIMIT_REDIS_OPERATION_FAILED_DB_FALLBACK',
        component: LoginRateLimitGuard.name,
        fallback: 'db_account_lock_check',
        ip,
        emailMasked: email ? maskEmailForLog(email) : null,
        error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
      });
      return this.checkDbAccountLock(email);
    }
  }

  private async checkDbAccountLock(email: string): Promise<boolean> {
    if (!email) return true;

    try {
      const customer = await this.prisma.customer.findUnique({
        where: { email },
        select: { lockUntil: true },
      });

      if (customer?.lockUntil && customer.lockUntil > new Date()) {
        throw new AccountLockedException(
          'Account temporarily locked due to too many failed attempts. Try again later.',
        );
      }
    } catch (err) {
      if (err instanceof AccountLockedException) throw err;
      this.structuredLogger.warn(
        LoginRateLimitGuard.name,
        'DB account lock check failed, allowing request',
        {
          eventType: 'INFRA',
          action: 'LOGIN_RATE_LIMIT_DB_FALLBACK_FAILED',
          component: LoginRateLimitGuard.name,
          fallback: 'db_account_lock_check',
          emailMasked: maskEmailForLog(email),
          error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
        },
      );
    }

    return true;
  }
}
