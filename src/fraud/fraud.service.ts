import { Inject, Injectable } from '@nestjs/common';

import { FraudDecisionResult } from './types/fraud-decision-result.type';
import { TransferFraudCheckInput } from './types/transfer-fraud-check-input.type';
import { WithdrawFraudCheckInput } from './types/withdraw-fraud-check-input.type';

import { TransferFraudRule, WithdrawFraudRule } from './rules/fraud-rule.interface';
import { TRANSFER_FRAUD_RULES, WITHDRAW_FRAUD_RULES } from './fraud.constants';

@Injectable()
export class FraudService {
  constructor(
    @Inject(TRANSFER_FRAUD_RULES)
    private readonly transferRules: TransferFraudRule[],
    @Inject(WITHDRAW_FRAUD_RULES)
    private readonly withdrawRules: WithdrawFraudRule[],
  ) {}

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