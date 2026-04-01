import { Inject, Injectable } from '@nestjs/common';

import { FraudDecisionResult } from './types/fraud-decision-result.type';
import { TransferFraudCheckInput } from './types/transfer-fraud-check-input.type';
import { WithdrawFraudCheckInput } from './types/withdraw-fraud-check-input.type';

import { TransferFraudRule, WithdrawFraudRule } from './rules/fraud-rule.interface';
import { TRANSFER_FRAUD_RULES, WITHDRAW_FRAUD_RULES } from './fraud.constants';
import type { Prisma } from '../generated/prisma/client';
import { StructuredLogger } from '../logger/structured-logger.service';

@Injectable()
export class FraudService {
  constructor(
    @Inject(TRANSFER_FRAUD_RULES)
    private readonly transferRules: TransferFraudRule[],
    @Inject(WITHDRAW_FRAUD_RULES)
    private readonly withdrawRules: WithdrawFraudRule[],
    private readonly structuredLogger: StructuredLogger,
  ) {}

  async evaluateTransfer(
    input: TransferFraudCheckInput,
    tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult> {
    for (const rule of this.transferRules) {
      const result = await rule.evaluate(input, tx);
      if (result && result.decision === 'REJECT') return result;
    }
    return { decision: 'APPROVE' };
  }

  async evaluateWithdraw(
    input: WithdrawFraudCheckInput,
    tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult> {
    for (const rule of this.withdrawRules) {
      const result = await rule.evaluate(input, tx);
      if (result && result.decision === 'REJECT') return result;
    }
    return { decision: 'APPROVE' };
  }

  async releaseTransferDailyReservation(
    input: TransferFraudCheckInput,
  ): Promise<void> {
    const rulesWithRelease = this.transferRules.filter(
      (
        rule,
      ): rule is TransferFraudRule & {
        releaseReservation: (payload: TransferFraudCheckInput) => Promise<void>;
      } =>
        typeof (rule as { releaseReservation?: unknown }).releaseReservation ===
        'function',
    );

    for (const rule of rulesWithRelease) {
      try {
        await rule.releaseReservation(input);
      } catch (error) {
        this.structuredLogger.warn(FraudService.name, 'Transfer reservation release failed', {
          eventType: 'FRAUD',
          action: 'RELEASE_TRANSFER_RESERVATION',
          rule: rule.name,
          userId: input.userId,
          referenceId: input.referenceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async releaseWithdrawDailyReservation(
    input: WithdrawFraudCheckInput,
  ): Promise<void> {
    const rulesWithRelease = this.withdrawRules.filter(
      (
        rule,
      ): rule is WithdrawFraudRule & {
        releaseReservation: (payload: WithdrawFraudCheckInput) => Promise<void>;
      } =>
        typeof (rule as { releaseReservation?: unknown }).releaseReservation ===
        'function',
    );

    for (const rule of rulesWithRelease) {
      try {
        await rule.releaseReservation(input);
      } catch (error) {
        this.structuredLogger.warn(FraudService.name, 'Withdraw reservation release failed', {
          eventType: 'FRAUD',
          action: 'RELEASE_WITHDRAW_RESERVATION',
          rule: rule.name,
          userId: input.userId,
          referenceId: input.referenceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}