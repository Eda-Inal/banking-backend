import type { EventType, TransactionType } from './enums';

export type TransactionEventOutcome = 'SUCCESS' | 'FAILURE';

export type TransactionEventMetadata = {
  transactionType: TransactionType;
  referenceId: string;
  amount: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  fraudRule?: string;
};

export type TransactionEventPayload = {
  actorId: string;
  resourceId: string; 
  traceId: string;

  outcome: TransactionEventOutcome;
  reasonCode?: string; 
  metadata: TransactionEventMetadata;
};

export type BankingEventEnvelope<TPayload> = {
    eventId: string;
    type: EventType | string;
    occurredAt: string;
    schemaVersion: string;
    payload: TPayload;
  };