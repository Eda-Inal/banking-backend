import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FraudService } from './fraud.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { CONFIG_KEYS } from '../config/config';
import { TRANSFER_FRAUD_RULES, WITHDRAW_FRAUD_RULES } from './fraud.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SameAccountTransferRule } from './rules/transfer/same-account-transfer.rule';
import { TransferAmountExceededRule } from './rules/transfer/transfer-amount-exceeded.rule';
import { TooManyTransfersInMinuteRule } from './rules/transfer/too-many-transfers-in-minute.rule';
import { DailyTransferLimitExceededRule } from './rules/transfer/daily-transfer-limit-exceeded.rule';
import { WithdrawAmountExceededRule } from './rules/withdraw/withdraw-amount-exceeded.rule';
import { DailyWithdrawLimitExceededRule } from './rules/withdraw/daily-withdraw-limit-exceeded.rule';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    {
      provide: TRANSFER_FRAUD_RULES,
      inject: [ConfigService, RedisService, PrismaService],
      useFactory: (
        config: ConfigService,
        redisService: RedisService,
        prismaService: PrismaService,
      ) => {
        const transferThreshold = Number(
          config.get<string>(CONFIG_KEYS.FRAUD_TRANSFER_MAX_AMOUNT) ?? '100000',
        );
        const transferPerMinuteLimit = Number(
          config.get<string>(CONFIG_KEYS.FRAUD_TRANSFERS_PER_MINUTE_LIMIT) ?? '5',
        );
        const dailyTransferLimit = Number(
          config.get<string>(CONFIG_KEYS.FRAUD_DAILY_TRANSFER_LIMIT) ?? '250000',
        );

        return [
          new SameAccountTransferRule(),
          new TransferAmountExceededRule(transferThreshold),
          new TooManyTransfersInMinuteRule(redisService, transferPerMinuteLimit),
          new DailyTransferLimitExceededRule(
            redisService,
            dailyTransferLimit,
            prismaService,
          ),
        ];
      },
    },
    {
      provide: WITHDRAW_FRAUD_RULES,
      inject: [ConfigService, RedisService, PrismaService],
      useFactory: (
        config: ConfigService,
        redisService: RedisService,
        prismaService: PrismaService,
      ) => {
        const withdrawThreshold = Number(
          config.get<string>(CONFIG_KEYS.FRAUD_WITHDRAW_MAX_AMOUNT) ?? '50000',
        );
        const dailyWithdrawLimit = Number(
          config.get<string>(CONFIG_KEYS.FRAUD_DAILY_WITHDRAW_LIMIT) ?? '100000',
        );

        return [
          new WithdrawAmountExceededRule(withdrawThreshold),
          new DailyWithdrawLimitExceededRule(
            redisService,
            dailyWithdrawLimit,
            prismaService,
          ),
        ];
      },
    },
    FraudService,
  ],
  exports: [FraudService],
})
export class FraudModule {}