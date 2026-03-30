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
  ) {}

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
      if (key) {
        await this.redis.getClient().set(key, 'done', 'EX', 60 * 5);
      }
      return result;
    } catch (err) {
      if (key) {
        if (!(err instanceof ConflictException)) {
          await this.redis.getClient().del(key);
        }
      }
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
      if (key) {
        await this.redis.getClient().set(key, 'done', 'EX', 60 * 5);
      }
      return result;
    } catch (err) {
      if (key) {
        if (!(err instanceof ConflictException)) {
          await this.redis.getClient().del(key);
        }
      }
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
      if (key) {
        await this.redis.getClient().set(key, 'done', 'EX', 60 * 5);
      }
      return result;
    } catch (err) {
      if (key) {
        if (!(err instanceof ConflictException)) {
          await this.redis.getClient().del(key);
        }
      }
      throw err;
    } finally {
      await this.releaseTransferUserLock(req);
    }
  }
}
