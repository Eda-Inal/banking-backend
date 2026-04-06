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
import { StructuredLogger } from '../../logger/structured-logger.service';

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
const IDEMPOTENCY_OPERATIONS = {
  DEPOSIT: 'deposit',
  WITHDRAW: 'withdraw',
  TRANSFER: 'transfer',
} as const;
type IdempotencyOperation =
  (typeof IDEMPOTENCY_OPERATIONS)[keyof typeof IDEMPOTENCY_OPERATIONS];

@Injectable()
export class TransactionsIdempotencyGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {}

  private getHeaderReferenceId(request: Request): string | undefined {
    const headerValue = request.headers['x-reference-id'];
    const fromHeader =
      typeof headerValue === 'string'
        ? headerValue.trim()
        : Array.isArray(headerValue)
          ? headerValue[0]?.trim()
          : '';
    return fromHeader || undefined;
  }

  private getBodyReferenceId(request: Request): string | undefined {
    const fromBody =
      typeof (request as any).body?.referenceId === 'string'
        ? (request as any).body.referenceId.trim()
        : '';
    return fromBody || undefined;
  }

  private extractReferenceId(request: Request): string | undefined {
    return this.getHeaderReferenceId(request) ?? this.getBodyReferenceId(request);
  }

  private extractOperation(
    request: Request & { body?: { fromAccountId?: unknown; toAccountId?: unknown } },
  ): IdempotencyOperation {
    const hasFromAccountId = typeof request.body?.fromAccountId === 'string';
    const hasToAccountId = typeof request.body?.toAccountId === 'string';

    if (hasFromAccountId && hasToAccountId) {
      return IDEMPOTENCY_OPERATIONS.TRANSFER;
    }
    if (hasFromAccountId) {
      return IDEMPOTENCY_OPERATIONS.WITHDRAW;
    }
    if (hasToAccountId) {
      return IDEMPOTENCY_OPERATIONS.DEPOSIT;
    }

    throw new BadRequestException('Unable to infer idempotency operation');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      IdempotencyRequest & { user?: any }
    >();

    const userId: string | undefined = request.user?.userId;
    const referenceIdForLog = this.extractReferenceId(request);
    if (!userId) {
      this.structuredLogger.warn(
        TransactionsIdempotencyGuard.name,
        'Idempotency guard skipped because request user context is missing',
        {
          eventType: 'SECURITY',
          action: 'IDEMPOTENCY_SKIP_MISSING_USER',
          component: TransactionsIdempotencyGuard.name,
          fallback: 'skip_idempotency_guard',
          referenceId: referenceIdForLog,
        },
      );
      return true;
    }

    if (!this.redis.isReady()) {
      this.structuredLogger.warn(
        TransactionsIdempotencyGuard.name,
        'Redis unavailable, skipping idempotency guard',
        {
          eventType: 'INFRA',
          action: 'REDIS_IDEMPOTENCY_SKIP',
          userId,
          component: TransactionsIdempotencyGuard.name,
          fallback: 'skip_idempotency_guard',
          referenceId: referenceIdForLog,
        },
      );
      return true;
    }

    try {
      const headerReferenceId = this.getHeaderReferenceId(request);
      const bodyReferenceId = this.getBodyReferenceId(request);

      if (
        headerReferenceId &&
        bodyReferenceId &&
        headerReferenceId !== bodyReferenceId
      ) {
        throw new BadRequestException(
          'referenceId in header and body must match',
        );
      }

      const referenceId = headerReferenceId ?? bodyReferenceId;
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
            this.structuredLogger.warn(
              TransactionsIdempotencyGuard.name,
              'Transfer lock conflict',
              {
                eventType: 'TRANSACTION',
                action: 'TRANSFER_LOCK_CONFLICT',
                userId,
                operation: 'transfer',
                referenceId,
              },
            );
            throw new ConflictException(
              'Another transfer is already in progress',
            );
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
        this.structuredLogger.warn(
          TransactionsIdempotencyGuard.name,
          'Idempotency conflict in-flight',
          {
            eventType: 'TRANSACTION',
            action: 'IDEMPOTENCY_CONFLICT',
            userId,
            referenceId,
            operation,
            state: 'in-flight',
          },
        );
        throw new ConflictException('Duplicate request in progress');
      }
      throw new ConflictException('Duplicate request');
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.structuredLogger.warn(
        TransactionsIdempotencyGuard.name,
        'Idempotency guard redis operation failed, fail-open',
        {
          eventType: 'INFRA',
          action: 'REDIS_IDEMPOTENCY_OPERATION_FAILED_FAIL_OPEN',
          userId,
          component: TransactionsIdempotencyGuard.name,
          fallback: 'skip_idempotency_guard',
          referenceId: referenceIdForLog,
        },
      );
      return true;
    }
  }
}

