import { FraudCheckInput } from '../types/fraud-check-input.type';
import { FraudDecisionResult } from '../types/fraud-decision-result.type';

export interface FraudRule {
  name: string;
  evaluate(input: FraudCheckInput): FraudDecisionResult | null;
}