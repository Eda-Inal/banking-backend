import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';

export type IdempotencyRequest = Request & {
  idempotencyKey?: string;
  idempotencyReferenceId?: string;
  idempotencyOperation?: string;
};

const KEY_PREFIX = 'transactions:idempotency:';
const IN_FLIGHT_TTL_SECONDS = 30;

@Injectable()
export class TransactionsIdempotencyGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

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

      const key = `${KEY_PREFIX}${userId}:${operation}:${referenceId}`;
      const client = this.redis.getClient();

      const ok = await client.set(
        key,
        'in-flight',
        'EX',
        IN_FLIGHT_TTL_SECONDS,
        'NX',
      );
      
      if (ok === 'OK') {
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

