import { TransferFraudRule } from '../fraud-rule.interface';
import { TransferFraudCheckInput } from '../../types/transfer-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';

export class SameAccountTransferRule implements TransferFraudRule {
  name = 'SAME_ACCOUNT_TRANSFER';

  async evaluate(input: TransferFraudCheckInput): Promise<FraudDecisionResult | null> {
    if (input.fromAccountId === input.toAccountId) {
      return { decision: 'REJECT', reason: this.name };
    }
    return null;
  }
}