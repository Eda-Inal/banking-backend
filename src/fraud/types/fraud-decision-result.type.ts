export type FraudDecisionResult = {
    decision: 'APPROVE' | 'REJECT';
    reason?: string;
}