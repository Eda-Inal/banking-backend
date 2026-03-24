import { FraudDecisionResult } from '../types/fraud-decision-result.type';
import { TransferFraudCheckInput } from '../types/transfer-fraud-check-input.type';
import { WithdrawFraudCheckInput } from '../types/withdraw-fraud-check-input.type';

export interface TransferFraudRule {
  name: string;
  evaluate(input: TransferFraudCheckInput): Promise<FraudDecisionResult | null>;
}

export interface WithdrawFraudRule {
  name: string;
  evaluate(input: WithdrawFraudCheckInput): Promise<FraudDecisionResult | null>;
}