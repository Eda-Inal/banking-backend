import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from '../config/config';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

import { FraudDecisionResult } from './types/fraud-decision-result.type';
import { TransferFraudCheckInput } from './types/transfer-fraud-check-input.type';
import { WithdrawFraudCheckInput } from './types/withdraw-fraud-check-input.type';

import { TransferFraudRule, WithdrawFraudRule } from './rules/fraud-rule.interface';
import { SameAccountTransferRule } from './rules/transfer/same-account-transfer.rule';
import { TransferAmountExceededRule } from './rules/transfer/transfer-amount-exceeded.rule';
import { TooManyTransfersInMinuteRule } from './rules/transfer/too-many-transfers-in-minute.rule';
import { DailyTransferLimitExceededRule } from './rules/transfer/daily-transfer-limit-exceeded.rule';
import { WithdrawAmountExceededRule } from './rules/withdraw/withdraw-amount-exceeded.rule';
import { DailyWithdrawLimitExceededRule } from './rules/withdraw/daily-withdraw-limit-exceeded.rule';

@Injectable()
export class FraudService {
  private readonly transferRules: TransferFraudRule[];
  private readonly withdrawRules: WithdrawFraudRule[];

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {
    const transferThreshold = Number(
      this.configService.get<string>(CONFIG_KEYS.FRAUD_TRANSFER_MAX_AMOUNT) ?? '100000',
    );
    const withdrawThreshold = Number(
      this.configService.get<string>(CONFIG_KEYS.FRAUD_WITHDRAW_MAX_AMOUNT) ?? '50000',
    );
    const transferPerMinuteLimit = Number(
      this.configService.get<string>(CONFIG_KEYS.FRAUD_TRANSFERS_PER_MINUTE_LIMIT) ?? '5',
    );
    const dailyTransferLimit = Number(
      this.configService.get<string>(CONFIG_KEYS.FRAUD_DAILY_TRANSFER_LIMIT) ?? '250000',
    );
    const dailyWithdrawLimit = Number(
      this.configService.get<string>(CONFIG_KEYS.FRAUD_DAILY_WITHDRAW_LIMIT) ?? '100000',
    );

    this.transferRules = [
      new SameAccountTransferRule(),
      new TransferAmountExceededRule(transferThreshold),
      new TooManyTransfersInMinuteRule(this.redisService, transferPerMinuteLimit),
      new DailyTransferLimitExceededRule(this.prisma, dailyTransferLimit),
    ];

    this.withdrawRules = [
      new WithdrawAmountExceededRule(withdrawThreshold),
      new DailyWithdrawLimitExceededRule(this.prisma, dailyWithdrawLimit),
    ];
  }

  async evaluateTransfer(input: TransferFraudCheckInput): Promise<FraudDecisionResult> {
    for (const rule of this.transferRules) {
      const result = await rule.evaluate(input);
      if (result && result.decision === 'REJECT') return result;
    }
    return { decision: 'APPROVE' };
  }

  async evaluateWithdraw(input: WithdrawFraudCheckInput): Promise<FraudDecisionResult> {
    for (const rule of this.withdrawRules) {
      const result = await rule.evaluate(input);
      if (result && result.decision === 'REJECT') return result;
    }
    return { decision: 'APPROVE' };
  }
}