import { Inject, Injectable, Logger } from '@nestjs/common';

import { FraudDecisionResult } from './types/fraud-decision-result.type';
import { TransferFraudCheckInput } from './types/transfer-fraud-check-input.type';
import { WithdrawFraudCheckInput } from './types/withdraw-fraud-check-input.type';

import { TransferFraudRule, WithdrawFraudRule } from './rules/fraud-rule.interface';
import { TRANSFER_FRAUD_RULES, WITHDRAW_FRAUD_RULES } from './fraud.constants';
import type { Prisma } from '../generated/prisma/client';

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    @Inject(TRANSFER_FRAUD_RULES)
    private readonly transferRules: TransferFraudRule[],
    @Inject(WITHDRAW_FRAUD_RULES)
    private readonly withdrawRules: WithdrawFraudRule[],
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
        this.logger.warn(
          `Withdraw reservation release failed for rule=${rule.name} userId=${input.userId} referenceId=${input.referenceId} error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}