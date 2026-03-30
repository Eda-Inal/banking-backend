import { WithdrawFraudRule } from '../fraud-rule.interface';
import { WithdrawFraudCheckInput } from '../../types/withdraw-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';
import type { Prisma } from '../../../generated/prisma/client';

export class WithdrawAmountExceededRule implements WithdrawFraudRule {
  name = 'WITHDRAW_AMOUNT_EXCEEDED';

  constructor(private readonly threshold: number) {}

  async evaluate(
    input: WithdrawFraudCheckInput,
    _tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult | null> {
    if (input.amount.gt(this.threshold)) {
      return { decision: 'REJECT', reason: this.name };
    }
    return null;
  }
}