import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { CONFIG_KEYS } from '../../config/config';
import { RedisService } from '../../redis/redis.service';

export type IdempotencyRequest = Request & {
  idempotencyKey?: string;
  idempotencyReferenceId?: string;
  idempotencyOperation?: string;
  transferUserLockKey?: string;
  transferUserLockToken?: string;
};

const KEY_PREFIX = 'transactions:idempotency:';
const TRANSFER_USER_LOCK_PREFIX = 'transactions:user-lock:';
const DEFAULT_IN_FLIGHT_TTL_SECONDS = 180;

@Injectable()
export class TransactionsIdempotencyGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private extractReferenceId(request: Request): string | undefined {
    const headerValue = request.headers['x-reference-id'];
    const fromHeader =
      typeof headerValue === 'string'
        ? headerValue.trim()
        : Array.isArray(headerValue)
          ? headerValue[0]?.trim()
          : '';
    if (fromHeader) {
      return fromHeader;
    }

    const fromBody =
      typeof (request as any).body?.referenceId === 'string'
        ? (request as any).body.referenceId.trim()
        : '';
    return fromBody || undefined;
  }

  private extractOperation(request: Request): string {
    const path = request.path ?? '';
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? 'unknown';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context
        .switchToHttp()
        .getRequest<IdempotencyRequest & { user?: any }>();

      const userId: string | undefined = request.user?.userId;
      if (!userId) {
        return true;
      }

      const referenceId = this.extractReferenceId(request);
      if (!referenceId) {
        throw new BadRequestException('Missing referenceId');
      }
      const operation = this.extractOperation(request);
      const inFlightTtlSeconds = Number(
        this.config.get<string>(
          CONFIG_KEYS.TRANSACTIONS_IDEMPOTENCY_IN_FLIGHT_TTL_SEC,
        ) ?? DEFAULT_IN_FLIGHT_TTL_SECONDS.toString(),
      );

      const key = `${KEY_PREFIX}${userId}:${operation}:${referenceId}`;
      const client = this.redis.getClient();

      const ok = await client.set(
        key,
        'in-flight',
        'EX',
        inFlightTtlSeconds,
        'NX',
      );
      
      if (ok === 'OK') {
        if (operation === 'transfer') {
          const transferLockKey = `${TRANSFER_USER_LOCK_PREFIX}${userId}:TRANSFER`;
          const transferLockToken = randomUUID();
          const lockOk = await client.set(
            transferLockKey,
            transferLockToken,
            'EX',
            inFlightTtlSeconds,
            'NX',
          );
          if (lockOk !== 'OK') {
            await client.del(key);
            throw new ConflictException('Another transfer is already in progress');
          }
          request.transferUserLockKey = transferLockKey;
          request.transferUserLockToken = transferLockToken;
        }

        request.idempotencyKey = key;
        request.idempotencyReferenceId = referenceId;
        request.idempotencyOperation = operation;
        return true;
      }
      
      const state = await client.get(key);
      
      if (state === 'done') {
        request.idempotencyKey = key;
        request.idempotencyReferenceId = referenceId;
        request.idempotencyOperation = operation;
        return true;
      }
      
      if (state === 'in-flight') {
        throw new ConflictException('Duplicate request in progress');
      }
      throw new ConflictException('Duplicate request');
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

