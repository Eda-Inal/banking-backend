import { FraudDecisionResult } from '../types/fraud-decision-result.type';
import { TransferFraudCheckInput } from '../types/transfer-fraud-check-input.type';
import { WithdrawFraudCheckInput } from '../types/withdraw-fraud-check-input.type';
import type { Prisma } from '../../generated/prisma/client';

export interface TransferFraudRule {
  name: string;
  evaluate(
    input: TransferFraudCheckInput,
    tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult | null>;
}

export interface WithdrawFraudRule {
  name: string;
  evaluate(
    input: WithdrawFraudCheckInput,
    tx?: Prisma.TransactionClient,
  ): Promise<FraudDecisionResult | null>;
}