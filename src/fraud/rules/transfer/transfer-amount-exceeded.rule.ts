import { TransferFraudRule } from '../fraud-rule.interface';
import { TransferFraudCheckInput } from '../../types/transfer-fraud-check-input.type';
import { FraudDecisionResult } from '../../types/fraud-decision-result.type';

export class TransferAmountExceededRule implements TransferFraudRule {
  name = 'TRANSFER_AMOUNT_EXCEEDED';

  constructor(private readonly threshold: number) {}

  async evaluate(input: TransferFraudCheckInput): Promise<FraudDecisionResult | null> {
    if (input.amount.gt(this.threshold)) {
      return { decision: 'REJECT', reason: this.name };
    }
    return null;
  }
}