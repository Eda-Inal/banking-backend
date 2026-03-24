import { FraudRule } from "./fraud-rule.interface";
import { FraudCheckInput } from "../types/fraud-check-input.type";
import { FraudDecisionResult } from "../types/fraud-decision-result.type";

export class AmountExceededRule implements FraudRule {
    name = 'AMOUNT_EXCEEDED';

    constructor(private readonly threshold: number) { }

    evaluate(input: FraudCheckInput): FraudDecisionResult | null {
        if (input.amount.gt(this.threshold)) {
            return {
                decision: 'REJECT',
                reason: 'Amount exceeded'
            };
        }
        return null;
    }


}
