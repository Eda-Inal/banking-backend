import { Injectable } from '@nestjs/common';
import { FraudCheckInput } from './types/fraud-check-input.type';
import { FraudDecisionResult } from './types/fraud-decision-result.type';
import { FraudRule } from './rules/fraud-rule.interface';
import { AmountExceededRule } from './rules/amount-exceeded.rule';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from '../config/config';

@Injectable()
export class FraudService {
  private readonly rules: FraudRule[];

  constructor(private readonly config: ConfigService) {

    const threshold = Number(this.config.get<string>(CONFIG_KEYS.FRAUD_TRANSFER_MAX_AMOUNT) ?? 100000);

    this.rules = [new AmountExceededRule(threshold)];
  }

  evaluateTransfer(input: FraudCheckInput): FraudDecisionResult {
    for (const rule of this.rules) {
      
      const result = rule.evaluate(input);
      if (result && result.decision === 'REJECT') {
        return result;
      }
    }

    return { decision: 'APPROVE' };
  }
}