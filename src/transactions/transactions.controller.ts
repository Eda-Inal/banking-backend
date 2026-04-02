import { ConflictException, Controller, UseGuards, Post, Body, Req } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateDepositRequestDto } from './dto/create-deposit-request';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { CreateWithdrawRequestDto } from './dto/create-withdraw-request';
import { CreateTransferRequestDto } from './dto/create-transfer-request';
import { RedisService } from '../redis/redis.service';
import { TransferRateLimitGuard } from './guards/transfer-rate-limit.guard';
import {
  TransactionsIdempotencyGuard,
  type IdempotencyRequest,
} from './guards/transactions-idempotency.guard';
import { StructuredLogger } from '../logger/structured-logger.service';

type IdempotencyOperation = 'deposit' | 'withdraw' | 'transfer';

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  private static readonly RELEASE_USER_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly redis: RedisService,
    private readonly structuredLogger: StructuredLogger,
  ) {}


  private async markIdempotencyKeyDone(
    key: string | undefined,
    operation: IdempotencyOperation,
  ): Promise<void> {
    if (!key) return;
    try {
      await this.redis.getClient().set(key, 'done', 'EX', 60 * 5);
    } catch (err) {
      this.structuredLogger.warn(
        TransactionsController.name,
        'Failed to mark idempotency key as done in Redis',
        {
          eventType: 'TRANSACTION',
          action: 'IDEMPOTENCY_DONE_REDIS_FAILED',
          operation,
          idempotencyKey: key,
          error:
            err instanceof Error
              ? { message: err.message, name: err.name }
              : { message: String(err) },
        },
      );

      try {
        await this.redis.getClient().del(key);
      } catch (delErr) {
        this.structuredLogger.warn(
          TransactionsController.name,
          'Failed to clear idempotency in-flight key after Redis done-set failure',
          {
            eventType: 'TRANSACTION',
            action: 'IDEMPOTENCY_DONE_REDIS_FAILED_DEL_INFLIGHT_FAILED',
            operation,
            idempotencyKey: key,
            error:
              delErr instanceof Error
                ? { message: delErr.message, name: delErr.name }
                : { message: String(delErr) },
          },
        );
      }
    }
  }

  private async tryDeleteIdempotencyKey(
    key: string | undefined,
    err: unknown,
    operation: IdempotencyOperation,
  ): Promise<void> {
    if (!key || err instanceof ConflictException) return;
    try {
      await this.redis.getClient().del(key);
    } catch (delErr) {
      this.structuredLogger.warn(
        TransactionsController.name,
        'Failed to delete idempotency in-flight key on error path',
        {
          eventType: 'TRANSACTION',
          action: 'IDEMPOTENCY_INFLIGHT_DEL_FAILED',
          operation,
          idempotencyKey: key,
          error: delErr instanceof Error ? { message: delErr.message, name: delErr.name } : { message: String(delErr) },
        },
      );
    }
  }

  private async releaseTransferUserLock(req: IdempotencyRequest): Promise<void> {
    const lockKey = req.transferUserLockKey;
    const lockToken = req.transferUserLockToken;
    if (!lockKey || !lockToken) return;

    try {
      await this.redis.getClient().eval(
        TransactionsController.RELEASE_USER_LOCK_LUA,
        1,
        lockKey,
        lockToken,
      );
    } catch (err) {

      this.structuredLogger.warn(
        TransactionsController.name,
        'Failed to release transfer user lock in Redis',
        {
          eventType: 'TRANSACTION',
          action: 'TRANSFER_USER_LOCK_RELEASE_FAILED',
          lockKey,
          error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
        },
      );
    } finally {
      req.transferUserLockKey = undefined;
      req.transferUserLockToken = undefined;
    }
  }

  @Post('deposit')
  @UseGuards(TransactionsIdempotencyGuard)
  async createDeposit(
    @CurrentUser() user: CurrentUserPayload,
    @Body() createDepositRequestDto: CreateDepositRequestDto,
    @Req() req: IdempotencyRequest,
  ): Promise<TransactionResponseDto> {
    const key = req.idempotencyKey;
    try {
      const result = await this.transactionsService.createDeposit(
        user.userId,
        createDepositRequestDto,
      );
      await this.markIdempotencyKeyDone(key, 'deposit');
      return result;
    } catch (err) {
      await this.tryDeleteIdempotencyKey(key, err, 'deposit');
      throw err;
    }
  }

  @Post('withdraw')
  @UseGuards(TransferRateLimitGuard, TransactionsIdempotencyGuard)
  async createWithdraw(
    @CurrentUser() user: CurrentUserPayload,
    @Body() createWithdrawRequestDto: CreateWithdrawRequestDto,
    @Req() req: IdempotencyRequest,
  ): Promise<TransactionResponseDto> {
    const key = req.idempotencyKey;
    try {
      const result = await this.transactionsService.createWithdraw(
        user.userId,
        createWithdrawRequestDto,
      );
      await this.markIdempotencyKeyDone(key, 'withdraw');
      return result;
    } catch (err) {
      await this.tryDeleteIdempotencyKey(key, err, 'withdraw');
      throw err;
    }
  }

  @Post('transfer')
  @UseGuards(TransferRateLimitGuard, TransactionsIdempotencyGuard)
  async createTransfer(
    @CurrentUser() user: CurrentUserPayload,
    @Body() createTransferRequestDto: CreateTransferRequestDto,
    @Req() req: IdempotencyRequest,
  ): Promise<TransactionResponseDto> {
    const key = req.idempotencyKey;
    try {
      const result = await this.transactionsService.createTransfer(
        user.userId,
        createTransferRequestDto,
      );
      await this.markIdempotencyKeyDone(key, 'transfer');
      return result;
    } catch (err) {
      await this.tryDeleteIdempotencyKey(key, err, 'transfer');
      throw err;
    } finally {
      await this.releaseTransferUserLock(req);
    }
  }
}
