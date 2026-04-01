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
      if (result && result.decision === 'REJECT') {
        this.structuredLogger.warn(FraudService.name, 'Fraud transfer evaluation rejected', {
          eventType: 'FRAUD',
          action: 'EVALUATE_TRANSFER',
          decision: 'REJECT',
          rule: result.reason ?? rule.name,
          userId: input.userId,
          referenceId: input.referenceId,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount.toString(),
        });
        return result;
      }
    }
    this.structuredLogger.debug(FraudService.name, 'Fraud transfer evaluation approved', {
      eventType: 'FRAUD',
      action: 'EVALUATE_TRANSFER',
      decision: 'APPROVE',
      userId: input.userId,
      referenceId: input.referenceId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount.toString(),
    });
    return { decision: 'APPROVE' };
  }

  async evaluateWithdraw(
    input: WithdrawFraudCheckInput,
    tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult> {
    for (const rule of this.withdrawRules) {
      const result = await rule.evaluate(input, tx);
      if (result && result.decision === 'REJECT') {
        this.structuredLogger.warn(FraudService.name, 'Fraud withdraw evaluation rejected', {
          eventType: 'FRAUD',
          action: 'EVALUATE_WITHDRAW',
          decision: 'REJECT',
          rule: result.reason ?? rule.name,
          userId: input.userId,
          referenceId: input.referenceId,
          fromAccountId: input.fromAccountId,
          amount: input.amount.toString(),
        });
        return result;
      }
    }
    this.structuredLogger.debug(FraudService.name, 'Fraud withdraw evaluation approved', {
      eventType: 'FRAUD',
      action: 'EVALUATE_WITHDRAW',
      decision: 'APPROVE',
      userId: input.userId,
      referenceId: input.referenceId,
      fromAccountId: input.fromAccountId,
      amount: input.amount.toString(),
    });
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
        this.structuredLogger.error(FraudService.name, 'Transfer reservation release failed', {
          details: {
            eventType: 'FRAUD',
            action: 'RELEASE_TRANSFER_RESERVATION',
            rule: rule.name,
            userId: input.userId,
            referenceId: input.referenceId,
          },
          error: error instanceof Error ? error : { message: String(error) },
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
        this.structuredLogger.error(FraudService.name, 'Withdraw reservation release failed', {
          details: {
            eventType: 'FRAUD',
            action: 'RELEASE_WITHDRAW_RESERVATION',
            rule: rule.name,
            userId: input.userId,
            referenceId: input.referenceId,
          },
          error: error instanceof Error ? error : { message: String(error) },
        });
      }
    }
  }
}